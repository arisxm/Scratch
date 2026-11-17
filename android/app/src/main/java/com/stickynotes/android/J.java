package com.stickynotes.android;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Small helpers over org.json, whose JSONException is a checked exception on Android. */
final class J {
    private J() {}

    static JSONObject put(JSONObject o, String key, Object value) {
        try {
            o.put(key, value == null ? JSONObject.NULL : value);
        } catch (JSONException e) {
            throw new IllegalArgumentException(e);
        }
        return o;
    }

    static JSONObject obj(Object... kv) {
        JSONObject o = new JSONObject();
        for (int i = 0; i + 1 < kv.length; i += 2) put(o, (String) kv[i], kv[i + 1]);
        return o;
    }

    static JSONObject parseObject(String s) {
        try {
            return new JSONObject(s);
        } catch (JSONException | NullPointerException e) {
            return null;
        }
    }

    static JSONArray parseArray(String s) {
        try {
            return new JSONArray(s);
        } catch (JSONException | NullPointerException e) {
            return new JSONArray();
        }
    }

    static JSONObject copy(JSONObject o) {
        try {
            return new JSONObject(o.toString());
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    /** The value, or null for a missing key or JSON null. */
    static Object get(JSONObject o, String key) {
        if (o == null) return null;
        Object v = o.opt(key);
        return v == JSONObject.NULL ? null : v;
    }

    static Object at(JSONArray a, int i) {
        Object v = a.opt(i);
        return v == JSONObject.NULL ? null : v;
    }

    static boolean isNum(Object v) {
        if (!(v instanceof Number)) return false;
        double d = ((Number) v).doubleValue();
        return !Double.isNaN(d) && !Double.isInfinite(d);
    }

    static boolean isInt(Object v) {
        return isNum(v) && ((Number) v).doubleValue() == Math.rint(((Number) v).doubleValue());
    }

    static double num(JSONObject o, String key, double fallback) {
        Object v = get(o, key);
        return isNum(v) ? ((Number) v).doubleValue() : fallback;
    }

    static String str(JSONObject o, String key, String fallback) {
        Object v = get(o, key);
        return v instanceof String ? (String) v : fallback;
    }

    static boolean bool(JSONObject o, String key) {
        return Boolean.TRUE.equals(get(o, key));
    }

    /** A JavaScript literal for a value (JSON is valid JavaScript). */
    static String js(Object v) {
        if (v == null || v == JSONObject.NULL) return "null";
        if (v instanceof String) return JSONObject.quote((String) v);
        if (v instanceof Boolean || v instanceof JSONObject || v instanceof JSONArray) return v.toString();
        if (v instanceof Number) return isNum(v) ? JSONObject.wrap(v).toString() : "null";
        Object wrapped = JSONObject.wrap(v);
        return wrapped == null ? "null" : (wrapped instanceof String ? JSONObject.quote((String) wrapped) : wrapped.toString());
    }
}
