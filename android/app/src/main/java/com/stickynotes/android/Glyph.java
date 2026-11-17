package com.stickynotes.android;

import android.graphics.Canvas;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.drawable.Drawable;

/** The bubble menu's line icons, drawn on a 24-unit grid in the app's ink colour. */
final class Glyph extends Drawable {
    private final String kind;
    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);

    Glyph(String kind, int color) {
        this.kind = kind;
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(1.8f);
        p.setStrokeCap(Paint.Cap.ROUND);
        p.setStrokeJoin(Paint.Join.ROUND);
        p.setColor(color);
        fill.setColor(color);
    }

    @Override
    public void draw(Canvas c) {
        Rect b = getBounds();
        c.save();
        c.translate(b.left, b.top);
        c.scale(b.width() / 24f, b.height() / 24f);
        switch (kind) {
            case "note": {
                c.drawRoundRect(new RectF(4, 4, 20, 20), 2.5f, 2.5f, p);
                c.drawLine(12, 8.5f, 12, 15.5f, p);
                c.drawLine(8.5f, 12, 15.5f, 12, p);
                break;
            }
            case "notepad": {
                Path pen = new Path();
                pen.moveTo(4, 20);
                pen.lineTo(4.6f, 16.2f);
                pen.lineTo(15.5f, 5.3f);
                pen.lineTo(18.7f, 8.5f);
                pen.lineTo(7.8f, 19.4f);
                pen.close();
                c.drawPath(pen, p);
                c.drawLine(13.4f, 7.4f, 16.6f, 10.6f, p);
                break;
            }
            case "timer": {
                c.drawCircle(12, 13.5f, 7.5f, p);
                c.drawLine(12, 13.5f, 12, 9.5f, p);
                c.drawLine(12, 13.5f, 14.8f, 15.2f, p);
                c.drawLine(9.5f, 3, 14.5f, 3, p);
                break;
            }
            case "hidden": {
                c.drawRoundRect(new RectF(3.5f, 4.5f, 20.5f, 8.5f), 1.2f, 1.2f, p);
                Path box = new Path();
                box.moveTo(5, 8.5f);
                box.lineTo(5, 19.5f);
                box.lineTo(19, 19.5f);
                box.lineTo(19, 8.5f);
                c.drawPath(box, p);
                c.drawLine(10, 12.5f, 14, 12.5f, p);
                break;
            }
            case "eye":
            case "eye-off": {
                Path eye = new Path();
                eye.moveTo(2.5f, 12);
                eye.quadTo(12, 2.5f, 21.5f, 12);
                eye.quadTo(12, 21.5f, 2.5f, 12);
                c.drawPath(eye, p);
                c.drawCircle(12, 12, 3, p);
                if (kind.equals("eye-off")) c.drawLine(4, 4, 20, 20, p);
                break;
            }
            case "collapse": {
                Path a = new Path();
                a.moveTo(7, 10);
                a.lineTo(12, 5.5f);
                a.lineTo(17, 10);
                a.moveTo(7, 18.5f);
                a.lineTo(12, 14);
                a.lineTo(17, 18.5f);
                c.drawPath(a, p);
                break;
            }
            case "expand": {
                Path a = new Path();
                a.moveTo(7, 5.5f);
                a.lineTo(12, 10);
                a.lineTo(17, 5.5f);
                a.moveTo(7, 14);
                a.lineTo(12, 18.5f);
                a.lineTo(17, 14);
                c.drawPath(a, p);
                break;
            }
            case "settings": {
                c.drawCircle(12, 12, 3, p);
                c.drawCircle(12, 12, 6.8f, p);
                for (int i = 0; i < 8; i++) {
                    double a = Math.PI / 4 * i;
                    float cos = (float) Math.cos(a), sin = (float) Math.sin(a);
                    c.drawLine(12 + 6.8f * cos, 12 + 6.8f * sin, 12 + 9.4f * cos, 12 + 9.4f * sin, p);
                }
                break;
            }
            case "about": {
                c.drawCircle(12, 12, 9, p);
                c.drawLine(12, 11, 12, 16.5f, p);
                c.drawCircle(12, 7.8f, 1.1f, fill);
                break;
            }
            case "quit": {
                c.drawArc(new RectF(4.5f, 5, 19.5f, 20), -55, 290, false, p);
                c.drawLine(12, 3, 12, 11.5f, p);
                break;
            }
            default:
                break;
        }
        c.restore();
    }

    @Override
    public void setAlpha(int alpha) {
        p.setAlpha(alpha);
        fill.setAlpha(alpha);
    }

    @Override
    public void setColorFilter(ColorFilter cf) {
        p.setColorFilter(cf);
        fill.setColorFilter(cf);
    }

    @Override
    public int getOpacity() {
        return PixelFormat.TRANSLUCENT;
    }
}
