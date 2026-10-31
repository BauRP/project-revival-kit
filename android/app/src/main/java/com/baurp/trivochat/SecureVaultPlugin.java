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
        byte[] input = plaintext.getBytes(StandardCharsets.UTF_8);
        if (input.length > MAX_IDENTITY_BYTES) throw new IllegalArgumentException("Identity too large");
        byte[] iv = new byte[IV_BYTES];
        random.nextBytes(iv);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key(), new GCMParameterSpec(TAG_BITS, iv));
        byte[] sealed = cipher.doFinal(input);
        return Base64.encodeToString(iv, Base64.NO_WRAP) + "." +
                Base64.encodeToString(sealed, Base64.NO_WRAP);
    }

    private String open(String encrypted) throws Exception {
        if (encrypted == null || encrypted.length() > MAX_IDENTITY_BYTES * 2)
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

    private AtomicFile backupFile() {
        return new AtomicFile(new File(getContext().getFilesDir(), BACKUP));
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
            if (!file.getBaseFile().exists()) {
                data.put("sealed", JSObject.NULL);
            } else {
                byte[] bytes = file.readFully();
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
