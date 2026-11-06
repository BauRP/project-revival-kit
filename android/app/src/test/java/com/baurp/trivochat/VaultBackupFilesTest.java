package com.baurp.trivochat;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public final class VaultBackupFilesTest {
    @Rule public final TemporaryFolder temp = new TemporaryFolder();

    private void write(File file, int length) throws IOException {
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(new byte[length]);
        }
    }

    @Test public void existingLegacyBackupAloneProvesIdentityIsRecoverable() throws Exception {
        File base = new File(temp.getRoot(), "identity-backup-v1");
        write(new File(base.getPath() + ".bak"), 128);
        assertTrue(VaultBackupFiles.hasReadableBackup(base));
        assertTrue(VaultBackupFiles.fitsSealedSize(base, 512));
    }

    @Test public void atomicNewAloneIsNotAnEstablishedIdentity() throws Exception {
        File base = new File(temp.getRoot(), "identity-backup-v1");
        write(new File(base.getPath() + ".new"), 128);
        assertFalse(VaultBackupFiles.hasReadableBackup(base));
        assertFalse(VaultBackupFiles.fitsSealedSize(base, 512));
    }

    @Test public void rollbackBackupOverridesIncompleteNewerBase() throws Exception {
        File base = new File(temp.getRoot(), "identity-backup-v1");
        write(base, 1_024);
        write(new File(base.getPath() + ".bak"), 64);
        assertTrue(VaultBackupFiles.fitsSealedSize(base, 128));
        write(new File(base.getPath() + ".bak"), 256);
        assertFalse(VaultBackupFiles.fitsSealedSize(base, 128));
    }

    @Test public void emptyAndOversizedBackupsFailClosed() throws Exception {
        File base = new File(temp.getRoot(), "identity-backup-v1");
        write(base, 0);
        assertFalse(VaultBackupFiles.fitsSealedSize(base, 512));
        write(base, 513);
        assertFalse(VaultBackupFiles.fitsSealedSize(base, 512));
        write(base, 100);
        assertTrue(VaultBackupFiles.fitsSealedSize(base, 512));
    }
}
