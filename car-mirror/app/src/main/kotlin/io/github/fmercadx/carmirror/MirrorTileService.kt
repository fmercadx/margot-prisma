package io.github.fmercadx.carmirror

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * A Quick Settings tile: tap to start mirroring, tap again to stop.
 *
 * Starting opens the app, because Android asks "share your screen?" every time and only an
 * activity can show that prompt. Stopping happens right from the tile.
 */
class MirrorTileService : TileService() {

    override fun onStartListening() {
        render()
    }

    override fun onClick() {
        if (MirrorState.running) {
            startService(Intent(this, MirrorService::class.java).setAction(MirrorService.ACTION_STOP))
            return
        }
        val open = Intent(this, MainActivity::class.java)
            .setAction(MainActivity.ACTION_QUICK_START)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= 34) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE))
        } else {
            @Suppress("DEPRECATION") // the PendingIntent form only exists from API 34
            startActivityAndCollapse(open)
        }
    }

    private fun render() {
        val tile = qsTile ?: return
        tile.state = if (MirrorState.running) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tile.subtitle = when {
            !MirrorState.running -> "Off"
            MirrorState.paused != null -> "Paused"
            else -> "On"
        }
        tile.updateTile()
    }

    companion object {
        /** Asks the system to redraw the tile after mirroring starts, stops or pauses. */
        fun refresh(context: Context) {
            requestListeningState(context, ComponentName(context, MirrorTileService::class.java))
        }
    }
}
