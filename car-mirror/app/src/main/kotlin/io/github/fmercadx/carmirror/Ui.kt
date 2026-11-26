package io.github.fmercadx.carmirror

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.roundToInt

/**
 * The handful of building blocks the app's one screen is made of: cards, buttons, text and a
 * segmented switch, all drawn from res/values(-night)/colors.xml so light and dark themes
 * both work. Platform widgets only; the app has no UI library.
 */
internal class Ui(private val context: Context) {

    enum class Style { PRIMARY, SECONDARY, DANGER, QUIET }

    fun dp(value: Number): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), context.resources.displayMetrics).roundToInt()

    fun color(id: Int): Int = context.getColor(id)

    fun rounded(fill: Int, radiusDp: Number, strokeColor: Int? = null): GradientDrawable =
        GradientDrawable().apply {
            setColor(fill)
            cornerRadius = dp(radiusDp).toFloat()
            if (strokeColor != null) setStroke(dp(1), strokeColor)
        }

    fun text(
        value: CharSequence = "",
        sizeSp: Float = 15f,
        colorId: Int = R.color.on_surface,
        bold: Boolean = false,
        topDp: Int = 0,
    ) = TextView(context).apply {
        text = value
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
        setTextColor(color(colorId))
        if (bold) typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        setLineSpacing(0f, 1.15f)
        setPadding(0, dp(topDp), 0, 0)
    }

    fun vertical(paddingDp: Int = 0) = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(paddingDp), dp(paddingDp), dp(paddingDp), dp(paddingDp))
    }

    fun horizontal() = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
    }

    /** A white (or dark) rounded panel that groups one topic. */
    fun card() = vertical(paddingDp = 20).apply {
        background = rounded(color(R.color.surface), 22, color(R.color.outline))
    }

    fun button(label: String, style: Style, heightDp: Int = 56, onClick: () -> Unit) = Button(context).apply {
        text = label
        isAllCaps = false
        setTextSize(TypedValue.COMPLEX_UNIT_SP, if (heightDp >= 56) 17f else 15f)
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        stateListAnimator = null // flat: no shadow jumping on press
        minHeight = dp(heightDp)
        minimumHeight = dp(heightDp)
        setPadding(dp(18), 0, dp(18), 0)
        restyle(this, style, heightDp)
        setOnClickListener { onClick() }
    }

    /** Changes a button's emphasis, e.g. Resume becomes the main action while paused. */
    fun restyle(button: Button, style: Style, heightDp: Int = 56) {
        val (fill, fg) = when (style) {
            Style.PRIMARY -> R.color.accent to R.color.on_accent
            Style.SECONDARY -> R.color.surface_variant to R.color.on_surface
            Style.DANGER -> R.color.danger_container to R.color.danger
            Style.QUIET -> android.R.color.transparent to R.color.accent
        }
        button.setTextColor(color(fg))
        val radius = heightDp / 2
        button.background = RippleDrawable(
            ColorStateList.valueOf(color(R.color.ripple)),
            rounded(color(fill), radius),
            rounded(Color.WHITE, radius),
        )
    }

    /** A bulleted list whose wrapped lines stay indented under their text. */
    fun bullets(items: List<CharSequence>, sizeSp: Float = 15f, colorId: Int = R.color.on_surface, gapDp: Int = 12) =
        vertical().apply {
            items.forEachIndexed { i, item ->
                addView(horizontal().apply {
                    gravity = Gravity.TOP
                    addView(dot(6, R.color.muted), LinearLayout.LayoutParams(dp(6), dp(6)).apply {
                        topMargin = dp(sizeSp * 0.6f)
                    })
                    addView(text(item, sizeSp, colorId), weighted(startDp = 12))
                }, matchWidth(topDp = if (i == 0) 0 else gapDp))
            }
        }

    fun divider() = View(context).apply {
        setBackgroundColor(color(R.color.outline))
    }

    /** A small filled circle, e.g. the status light. */
    fun dot(sizeDp: Int, colorId: Int) = View(context).apply {
        background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(color(colorId))
        }
        layoutParams = LinearLayout.LayoutParams(dp(sizeDp), dp(sizeDp))
    }

    fun matchWidth(topDp: Int = 0, heightDp: Int? = null) =
        LinearLayout.LayoutParams(MATCH_PARENT, heightDp?.let { dp(it) } ?: WRAP_CONTENT).apply { topMargin = dp(topDp) }

    fun weighted(weight: Float = 1f, startDp: Int = 0) =
        LinearLayout.LayoutParams(0, WRAP_CONTENT, weight).apply { marginStart = dp(startDp) }

    /**
     * A row of options where exactly one is selected, like a car's drive-mode selector.
     * [onSelect] runs when the user picks one, not when [select] is called from code.
     */
    inner class Segmented(labels: List<String>, private val onSelect: (Int) -> Unit) {
        private val options = labels.mapIndexed { i, label ->
            text(label, 15f, bold = true).apply {
                gravity = Gravity.CENTER
                setPadding(dp(4), dp(11), dp(4), dp(11))
                setOnClickListener {
                    if (isEnabledForUser) {
                        select(i)
                        onSelect(i)
                    }
                }
            }
        }
        private var isEnabledForUser = true

        val view: LinearLayout = horizontal().apply {
            background = rounded(color(R.color.surface_variant), 14)
            setPadding(dp(4), dp(4), dp(4), dp(4))
            options.forEach { addView(it, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f)) }
        }

        fun select(index: Int) {
            options.forEachIndexed { i, option ->
                val on = i == index
                option.background = if (on) rounded(color(R.color.accent), 11) else null
                option.setTextColor(color(if (on) R.color.on_accent else R.color.on_surface))
            }
        }

        fun setEnabled(enabled: Boolean) {
            isEnabledForUser = enabled
            view.alpha = if (enabled) 1f else 0.5f
        }
    }
}
