package com.github.olddriverdoge.audiocpm;

/**
 * AC2 原生桥（p4a）。由 Python 侧 backend/native_bridge.py 通过 pyjnius 调用。
 *
 * 约定：所有方法都不抛异常，统一返回 JSON 字符串；失败时 {"ok":false,...} / {"status":"error",...}
 *
 * 待实现（见 APP_PACKAGING_HANDOFF.md §6）：
 *  1) peaks：MediaExtractor + MediaCodec 解码，按 presentationTimeUs 分桶取绝对峰值（0~1，未归一化）
 *  2) open：Intent(ACTION_VIEW) + FileProvider 的 content:// URI（Android 7+ 禁止 file://）
 *  3) hasAllFiles / openAllFilesSettings：MANAGE_EXTERNAL_STORAGE 检测与引导
 */
public class Ac2Bridge {

    /** 返回 {"ok":true,"peaks":[0.12,...]} 或 {"ok":false,"error":"..."} */
    public static String peaks(String path, int buckets) {
        // TODO: MediaCodec 解码 + 分桶
        return "{\"ok\":false,\"error\":\"peaks not implemented\"}";
    }

    /** 返回 {"status":"ok"} / {"status":"blocked"} / {"status":"error","message":"..."} */
    public static String open(String path, String pkg, String activity) {
        // TODO: FileProvider.getUriForFile(...) + Intent
        return "{\"status\":\"error\",\"message\":\"open not implemented\"}";
    }

    public static boolean hasAllFiles() {
        return false;
    }

    public static void openAllFilesSettings() {
        // TODO: 跳转 Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION
    }
}
