package com.github.olddriverdoge.audiocpm;

import android.app.Application;
import android.content.Context;

/** 全局 Context 持有：原生桥 / 播放服务都在这里取（不再依赖 p4a 的 PythonActivity）。 */
public class Ac2App extends Application {
    private static volatile Context sCtx;

    @Override
    public void onCreate() {
        super.onCreate();
        sCtx = getApplicationContext();
    }

    public static Context get() {
        return sCtx;
    }
}
