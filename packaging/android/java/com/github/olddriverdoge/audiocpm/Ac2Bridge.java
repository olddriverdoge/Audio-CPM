package com.github.olddriverdoge.audiocpm;

import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;

import androidx.core.content.FileProvider;

import org.kivy.android.PythonActivity;

import java.io.File;

/**
 * AC2 原生桥（p4a）。由 Python 侧 backend/native_bridge.py 通过 pyjnius 调用。
 * 所有方法都不抛异常，统一返回 JSON 字符串。
 */
public class Ac2Bridge {

    private static String esc(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ");
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".flac")) return "audio/flac";
        if (p.endsWith(".wav")) return "audio/wav";
        if (p.endsWith(".aif") || p.endsWith(".aiff")) return "audio/aiff";
        if (p.endsWith(".mp3")) return "audio/mpeg";
        if (p.endsWith(".m4a") || p.endsWith(".mp4") || p.endsWith(".aac")) return "audio/mp4";
        if (p.endsWith(".ogg")) return "audio/ogg";
        if (p.endsWith(".opus")) return "audio/opus";
        if (p.endsWith(".ape")) return "audio/x-ape";
        if (p.endsWith(".wv")) return "audio/x-wavpack";
        if (p.endsWith(".dsf") || p.endsWith(".dff")) return "audio/x-dsf";
        return "audio/*";
    }

    /** 返回 {"ok":true,"peaks":[...]} 或 {"ok":false,"error":"..."}（骨架，后续接 MediaCodec） */
    public static String peaks(String path, int buckets) {
        return "{\"ok\":false,\"error\":\"peaks not implemented\"}";
    }

    /** 返回 {"status":"ok"} / {"status":"error","message":"..."} */
    public static String open(String path, String pkg, String activity) {
        try {
            if (path == null || path.isEmpty()) {
                return "{\"status\":\"error\",\"message\":\"empty path\"}";
            }
            File f = new File(path);
            if (!f.isFile()) {
                return "{\"status\":\"error\",\"message\":\"file not found\"}";
            }
            PythonActivity act = PythonActivity.mActivity;
            if (act == null) {
                return "{\"status\":\"error\",\"message\":\"no activity\"}";
            }
            String authority = act.getPackageName() + ".fileprovider";
            Uri uri = FileProvider.getUriForFile(act, authority, f);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, mimeOf(path));
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            if (activity != null && activity.contains("/")) {
                String[] parts = activity.split("/", 2);
                i.setComponent(new ComponentName(parts[0], parts[1]));
            } else if (pkg != null && !pkg.isEmpty()) {
                i.setPackage(pkg);
            }
            act.startActivity(i);
            return "{\"status\":\"ok\"}";
        } catch (Throwable t) {
            return "{\"status\":\"error\",\"message\":\"" + esc(String.valueOf(t)) + "\"}";
        }
    }

    public static boolean hasAllFiles() {
        return false;
    }

    public static void openAllFilesSettings() {
    }
}
