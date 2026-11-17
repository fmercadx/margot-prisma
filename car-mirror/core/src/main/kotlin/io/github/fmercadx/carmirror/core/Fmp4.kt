package io.github.fmercadx.carmirror.core

import java.io.ByteArrayOutputStream

/**
 * Packs an H.264 stream into fragmented MP4 for the car's browser, which plays it through
 * Media Source Extensions (the one way to play live video on a plain-http page: WebCodecs
 * needs a secure context). One init segment describes the track; then each encoded frame is
 * a media segment of its own (moof + mdat), so the car can show it the moment it arrives.
 *
 * Only what MSE needs is written: one video track, no edit lists, decode time = presentation
 * time (the encoder is asked for no B-frames), 90 kHz timescale.
 */
object Fmp4 {
    const val TIMESCALE = 90_000

    /** SPS and PPS, from the encoder's codec-config output or an IDR frame (Annex B). */
    class ParameterSets(val sps: ByteArray, val pps: ByteArray) {
        /** The `codecs` value MSE wants, e.g. avc1.640028. */
        val codec: String get() = "avc1.%02x%02x%02x".format(sps[1].toInt() and 0xff, sps[2].toInt() and 0xff, sps[3].toInt() and 0xff)
    }

    /** NAL units of an Annex B byte stream (start codes 00 00 01 or 00 00 00 01), without start codes. */
    fun nalUnits(annexB: ByteArray): List<ByteArray> {
        val starts = ArrayList<Pair<Int, Int>>() // (start code position, payload position)
        var i = 0
        while (i + 2 < annexB.size) {
            if (annexB[i].toInt() == 0 && annexB[i + 1].toInt() == 0 && annexB[i + 2].toInt() == 1) {
                val codeStart = if (i > 0 && annexB[i - 1].toInt() == 0) i - 1 else i
                starts += codeStart to i + 3
                i += 3
            } else {
                i++
            }
        }
        return starts.mapIndexed { n, (_, payload) ->
            val end = if (n + 1 < starts.size) starts[n + 1].first else annexB.size
            annexB.copyOfRange(payload, end)
        }.filter { it.isNotEmpty() }
    }

    fun nalType(nal: ByteArray): Int = nal[0].toInt() and 0x1f

    /** The first SPS and PPS in [annexB], or null if either is missing. */
    fun parameterSets(annexB: ByteArray): ParameterSets? {
        val nals = nalUnits(annexB)
        val sps = nals.firstOrNull { nalType(it) == 7 } ?: return null
        val pps = nals.firstOrNull { nalType(it) == 8 } ?: return null
        return if (sps.size >= 4) ParameterSets(sps, pps) else null
    }

    /**
     * A frame's NAL units as an MP4 sample: each prefixed with its 4-byte length. Parameter
     * sets and access-unit delimiters are left out; the init segment carries the former.
     */
    fun sample(annexB: ByteArray): ByteArray {
        val out = ByteArrayOutputStream(annexB.size + 16)
        for (nal in nalUnits(annexB)) {
            if (nalType(nal) in setOf(7, 8, 9)) continue
            out.write(int32(nal.size))
            out.write(nal)
        }
        return out.toByteArray()
    }

    fun isKeyframe(annexB: ByteArray): Boolean = nalUnits(annexB).any { nalType(it) == 5 }

    /** ftyp + moov for one H.264 track of [width] x [height]. */
    fun initSegment(sets: ParameterSets, width: Int, height: Int): ByteArray {
        val ftyp = box("ftyp", ascii("isom"), int32(0x200), ascii("isom"), ascii("iso2"), ascii("avc1"), ascii("mp41"))
        val avcC = box("avcC",
            byteArrayOf(1, sets.sps[1], sets.sps[2], sets.sps[3], 0xff.toByte(), 0xe1.toByte()),
            int16(sets.sps.size), sets.sps,
            byteArrayOf(1), int16(sets.pps.size), sets.pps)
        val avc1 = box("avc1",
            ByteArray(6), int16(1),                 // reserved, data reference index
            ByteArray(16),                          // pre_defined and reserved
            int16(width), int16(height),
            int32(0x00480000), int32(0x00480000),   // 72 dpi
            int32(0), int16(1),                     // reserved, frame count
            ByteArray(32),                          // compressor name
            int16(0x18), int16(-1),                 // depth, pre_defined
            avcC)
        val stbl = box("stbl",
            fullBox("stsd", 0, 0, int32(1), avc1),
            fullBox("stts", 0, 0, int32(0)),
            fullBox("stsc", 0, 0, int32(0)),
            fullBox("stsz", 0, 0, int32(0), int32(0)),
            fullBox("stco", 0, 0, int32(0)))
        val minf = box("minf",
            fullBox("vmhd", 0, 1, ByteArray(8)),
            box("dinf", fullBox("dref", 0, 0, int32(1), fullBox("url ", 0, 1))),
            stbl)
        val mdia = box("mdia",
            fullBox("mdhd", 0, 0, int32(0), int32(0), int32(TIMESCALE), int32(0), int16(0x55c4), int16(0)),
            fullBox("hdlr", 0, 0, int32(0), ascii("vide"), ByteArray(12), ascii("Car Mirror\u0000")),
            minf)
        val tkhd = fullBox("tkhd", 0, 3,
            int32(0), int32(0), int32(TRACK), int32(0), int32(0), // times, track, reserved, duration
            ByteArray(8), int16(0), int16(0), int16(0), int16(0),  // reserved, layer, group, volume, reserved
            MATRIX, int32(width shl 16), int32(height shl 16))
        val mvhd = fullBox("mvhd", 0, 0,
            int32(0), int32(0), int32(1000), int32(0), int32(0x00010000), int16(0x0100),
            ByteArray(10), MATRIX, ByteArray(24), int32(TRACK + 1))
        val mvex = box("mvex", fullBox("trex", 0, 0, int32(TRACK), int32(1), int32(0), int32(0), int32(0)))
        return ftyp + box("moov", mvhd, box("trak", tkhd, mdia), mvex)
    }

    /** moof + mdat holding one frame, decoded at [decodeTime] (90 kHz ticks). */
    fun mediaSegment(sequence: Int, decodeTime: Long, duration: Int, sample: ByteArray, keyframe: Boolean): ByteArray {
        val flags = if (keyframe) 0x02000000 else 0x01010000 // sync sample; or depends on others, non-sync
        fun moof(dataOffset: Int) = box("moof",
            fullBox("mfhd", 0, 0, int32(sequence)),
            box("traf",
                fullBox("tfhd", 0, 0x020000, int32(TRACK)),          // default-base-is-moof
                fullBox("tfdt", 1, 0, int64(decodeTime)),
                fullBox("trun", 0, 0x000701, int32(1), int32(dataOffset), int32(duration), int32(sample.size), int32(flags))))
        val size = moof(0).size
        return moof(size + 8) + int32(sample.size + 8) + ascii("mdat") + sample
    }

    private const val TRACK = 1
    private val MATRIX = int32(0x00010000) + int32(0) + int32(0) + int32(0) + int32(0x00010000) + int32(0) +
        int32(0) + int32(0) + int32(0x40000000)

    private fun box(type: String, vararg payload: ByteArray): ByteArray {
        val size = 8 + payload.sumOf { it.size }
        val out = ByteArrayOutputStream(size)
        out.write(int32(size))
        out.write(ascii(type))
        payload.forEach(out::write)
        return out.toByteArray()
    }

    private fun fullBox(type: String, version: Int, flags: Int, vararg payload: ByteArray): ByteArray =
        box(type, byteArrayOf(version.toByte(), (flags shr 16).toByte(), (flags shr 8).toByte(), flags.toByte()), *payload)

    private fun ascii(s: String) = s.toByteArray(Charsets.ISO_8859_1)
    private fun int16(v: Int) = byteArrayOf((v shr 8).toByte(), v.toByte())
    private fun int32(v: Int) = byteArrayOf((v shr 24).toByte(), (v shr 16).toByte(), (v shr 8).toByte(), v.toByte())
    private fun int64(v: Long) = ByteArray(8).also { Crypto.putLong(it, 0, v) }
}
