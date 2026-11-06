package com.baurp.trivochat;

import java.io.File;

/**
 * The Android AtomicFile legacy rollback state uses a .bak alongside its
 * regular base. The .new file is an unfinished write, not durable identity
 * recovery. This policy is kept free of Android APIs so JVM tests run in CI.
 */
final class VaultBackupFiles {
    private VaultBackupFiles() {}

    static boolean hasReadableBackup(File base) {
        return base.isFile() || new File(base.getPath() + ".bak").isFile();
    }

    static boolean fitsSealedSize(File base, long maxBytes) {
        if (maxBytes <= 0) return false;
        // When a .bak exists, Android AtomicFile.openRead() restores it first
        // and intentionally prefers it to a newer uncommitted base.
        File backup = new File(base.getPath() + ".bak");
        File source = backup.isFile() ? backup : base;
        long length = source.isFile() ? source.length() : 0;
        return length > 0 && length <= maxBytes;
    }
}
