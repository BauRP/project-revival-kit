package com.baurp.trivochat;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.security.MessageDigest;
import org.json.JSONObject;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Local-only Android Keystore encryption for the identity and its automatic
 * device-resident recovery copy. No server, password, or external transfer.
 *
 * IMPORTANT: Android Keystore keys are not exportable; deleting the app or
 * losing the handset also loses the ability to decrypt this local copy.
 */
@CapacitorPlugin(name = "SecureVault")
public class SecureVaultPlugin extends Plugin {
    private static final String ALIAS = "trivo_identity_aes_gcm_v1";
    private static final String BACKUP = "identity-backup-v1";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;
    private static final int MAX_IDENTITY_BYTES = 32 * 1024;
    private static final int MAX_SCHEDULE_BYTES = 1024 * 1024;
    // A sealed identity contains a 12-byte IV and AES-GCM tag plus Base64
    // framing; preserve the prior input limit while bounding disk reads.
    private static final int MAX_SEALED_IDENTITY_BYTES = MAX_IDENTITY_BYTES * 2;
    private final SecureRandom random = new SecureRandom();

    private synchronized SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        KeyStore.Entry entry = store.getEntry(ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
                ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return generator.generateKey();
    }

    private String seal(String plaintext) throws Exception {
        return seal(plaintext, MAX_IDENTITY_BYTES);
    }

    private String seal(String plaintext, int maxBytes) throws Exception {
        byte[] input = plaintext.getBytes(StandardCharsets.UTF_8);
        if (input.length > maxBytes) throw new IllegalArgumentException("Vault plaintext too large");
        byte[] iv = new byte[IV_BYTES];
        random.nextBytes(iv);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key(), new GCMParameterSpec(TAG_BITS, iv));
        byte[] sealed = cipher.doFinal(input);
        return Base64.encodeToString(iv, Base64.NO_WRAP) + "." +
                Base64.encodeToString(sealed, Base64.NO_WRAP);
    }

    private String open(String encrypted) throws Exception {
        return open(encrypted, MAX_IDENTITY_BYTES);
    }

    private String open(String encrypted, int maxBytes) throws Exception {
        if (encrypted == null || encrypted.length() > maxBytes * 2)
            throw new IllegalArgumentException("Invalid vault payload");
        String[] parts = encrypted.split("\\.", -1);
        if (parts.length != 2) throw new IllegalArgumentException("Invalid vault format");
        byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
        byte[] sealed = Base64.decode(parts[1], Base64.NO_WRAP);
        if (iv.length != IV_BYTES) throw new IllegalArgumentException("Invalid vault IV");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(TAG_BITS, iv));
        return new String(cipher.doFinal(sealed), StandardCharsets.UTF_8);
    }

    @PluginMethod
    public void sealIdentity(PluginCall call) {
        try {
            String plaintext = call.getString("plaintext");
            if (plaintext == null) throw new IllegalArgumentException("Missing identity");
            JSObject data = new JSObject();
            data.put("sealed", seal(plaintext));
            call.resolve(data);
        } catch (Exception error) {
            call.reject("Cannot encrypt local identity", error.getMessage(), error);
        }
    }

    @PluginMethod
    public void openIdentity(PluginCall call) {
        try {
            JSObject data = new JSObject();
            data.put("plaintext", open(call.getString("sealed")));
            call.resolve(data);
        } catch (Exception error) {
            call.reject("Cannot unlock local identity", error.getMessage(), error);
        }
    }

    /** Scheduled chat text uses the same non-exportable Keystore key but
     * never enters the identity's on-disk recovery file.
     */
    @PluginMethod
    public void sealScheduledText(PluginCall call) {
        try {
            String plaintext = call.getString("plaintext");
            if (plaintext == null || plaintext.isEmpty())
                throw new IllegalArgumentException("Missing scheduled text");
            JSObject result = new JSObject();
            result.put("sealed", seal(plaintext, MAX_SCHEDULE_BYTES));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Cannot encrypt scheduled text", error.getMessage(), error);
        }
    }

    @PluginMethod
    public void openScheduledText(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("plaintext", open(call.getString("sealed"), MAX_SCHEDULE_BYTES));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Cannot decrypt scheduled text", error.getMessage(), error);
        }
    }

    /**
     * Recover this device's EXISTING v3 Onion Service identity after Android
     * recreates the foreground service with a null START_STICKY intent.
     *
     * This read-only operation MUST NOT generate a new Keystore key, or fall
     * back to a random Tor identity. No plaintext is written to the disk.
     */
    public static String recoverTorServiceKey(android.content.Context context) throws Exception {
        AtomicFile backup = new AtomicFile(new File(context.getFilesDir(), BACKUP));
        // Legacy AtomicFile may leave ONLY a .bak file if the process dies
        // between startWrite and finishWrite. readFully() restores that copy;
        // checking only the base file would incorrectly discard this identity.
        byte[] protectedBackup = readProtectedIdentityBackup(backup);
        if (protectedBackup == null)
            throw new IllegalStateException("No identity recovery copy on this device");

        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        KeyStore.Entry entry = store.getEntry(ALIAS, null);
        if (!(entry instanceof KeyStore.SecretKeyEntry))
            throw new IllegalStateException("Device identity Keystore key is unavailable");

        String sealedText = new String(protectedBackup, StandardCharsets.UTF_8);
        String[] parts = sealedText.split("\\.", -1);
        if (parts.length != 2) throw new IllegalArgumentException("Invalid sealed identity format");
        byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
        byte[] encrypted = Base64.decode(parts[1], Base64.NO_WRAP);
        if (iv.length != IV_BYTES || encrypted.length > MAX_IDENTITY_BYTES * 2)
            throw new IllegalArgumentException("Invalid sealed identity length");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE,
                ((KeyStore.SecretKeyEntry) entry).getSecretKey(),
                new GCMParameterSpec(TAG_BITS, iv));
        byte[] plaintext = cipher.doFinal(encrypted);
        try {
            JSONObject identity = new JSONObject(new String(plaintext, StandardCharsets.UTF_8));
            byte[] signingSecret = Base64.decode(
                    identity.getJSONObject("signing").getString("secretKey"), Base64.NO_WRAP);
            if (signingSecret.length != 64)
                throw new IllegalArgumentException("Invalid stored Ed25519 identity");
            byte[] seed = Arrays.copyOf(signingSecret, 32);
            Arrays.fill(signingSecret, (byte) 0);
            try {
                byte[] expanded = MessageDigest.getInstance("SHA-512").digest(seed);
                expanded[0] &= (byte) 248;
                expanded[31] &= (byte) 127;
                expanded[31] |= (byte) 64;
                // Identical expansion to torServiceKeyFromSigningSecret()
                // in the JS onion-id module.
                String result = "ED25519-V3:" + Base64.encodeToString(expanded, Base64.NO_WRAP);
                Arrays.fill(expanded, (byte) 0);
                return result;
            } finally {
                Arrays.fill(seed, (byte) 0);
            }
        } finally {
            Arrays.fill(plaintext, (byte) 0);
        }
    }

    private AtomicFile backupFile() {
        return new AtomicFile(new File(getContext().getFilesDir(), BACKUP));
    }

    /**
     * Read the last durable Keystore-sealed identity or recover AtomicFile's
     * legacy backup. Never use the existence of the base file alone as a
     * signal that this device lacks its existing Tor identity.
     */
    private static byte[] readProtectedIdentityBackup(AtomicFile file) throws Exception {
        File base = file.getBaseFile();
        if (!VaultBackupFiles.hasReadableBackup(base)) return null;
        if (!VaultBackupFiles.fitsSealedSize(base, MAX_SEALED_IDENTITY_BYTES))
            throw new IllegalStateException("Stored identity recovery copy is oversized or empty");
        byte[] bytes = file.readFully(); // Restores .bak using AtomicFile semantics.
        if (bytes.length == 0 || bytes.length > MAX_SEALED_IDENTITY_BYTES)
            throw new IllegalStateException("Invalid sealed recovery copy size");
        return bytes;
    }

    @PluginMethod
    public void saveIdentity(PluginCall call) {
        try {
            String sealed = call.getString("sealed");
            // Verify authentic encryption before replacing the recovery copy.
            String plaintext = open(sealed);
            if (plaintext.isEmpty()) throw new IllegalArgumentException("Empty identity");
            AtomicFile file = backupFile();
            FileOutputStream out = null;
            try {
                out = file.startWrite();
                out.write(sealed.getBytes(StandardCharsets.UTF_8));
                file.finishWrite(out);
            } catch (Exception e) {
                if (out != null) file.failWrite(out);
                throw e;
            }
            // An AtomicFile implementation may log a failed rename without
            // throwing. Do not report identity recovery is backed up unless
            // the committed bytes can be read and authenticated again.
            byte[] durable = readProtectedIdentityBackup(file);
            if (durable == null || !MessageDigest.isEqual(
                    durable, sealed.getBytes(StandardCharsets.UTF_8)))
                throw new IllegalStateException("Identity recovery write verification failed");
            open(new String(durable, StandardCharsets.UTF_8));
            call.resolve();
        } catch (Exception error) {
            call.reject("Cannot save encrypted identity", error.getMessage(), error);
        }
    }

    @PluginMethod
    public void loadIdentity(PluginCall call) {
        try {
            AtomicFile file = backupFile();
            JSObject data = new JSObject();
            byte[] bytes = readProtectedIdentityBackup(file);
            if (bytes == null) {
                data.put("sealed", JSObject.NULL);
            } else {
                String sealed = new String(bytes, StandardCharsets.UTF_8);
                // Never return corrupted / undecryptable backup as a valid key.
                open(sealed);
                data.put("sealed", sealed);
            }
            call.resolve(data);
        } catch (Exception error) {
            call.reject("Local identity backup cannot be opened", error.getMessage(), error);
        }
    }

    @PluginMethod
    public void clearIdentity(PluginCall call) {
        try {
            backupFile().delete();
            KeyStore store = KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            if (store.containsAlias(ALIAS)) store.deleteEntry(ALIAS);
            call.resolve();
        } catch (Exception error) {
            call.reject("Cannot clear local identity vault", error.getMessage(), error);
        }
    }
}
