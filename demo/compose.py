#!/usr/bin/env python3
"""Builds demo/kalypso-demo.mp4 from demo/clips/*.mp4 and demo/cards/*.png (title cards + caption overlays)."""
import json, os, subprocess, sys
D = os.path.dirname(os.path.abspath(__file__)); C, K, T = f"{D}/clips", f"{D}/cards", f"{D}/.build"
os.makedirs(T, exist_ok=True)
FPS, FADE = 30, 0.35
# (kind, name, seconds-on-screen target)
PLAN = [("card", "c00-intro", 4.5), ("card", "c01-problem", 6.5), ("card", "c02-answer", 5.5),
        ("clip", "01-landing", 14), ("clip", "02-store", 15), ("clip", "03-store-child", 12), ("clip", "04-query", 17),
        ("clip", "05-prove", 15), ("clip", "06-verify", 13), ("clip", "07-shred", 17), ("clip", "08-revoked", 8),
        ("clip", "09-archive", 15), ("clip", "10-docs", 12), ("card", "c99-outro", 7)]
dur = lambda f: float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]))
enc = ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", str(FPS)]
parts = []
for i, (kind, name, target) in enumerate(PLAN):
    out = f"{T}/{i:02d}-{name}.mp4"; parts.append(out)
    if kind == "card":
        n = int(target * FPS)
        vf = (f"scale=2112:-1,zoompan=z='1+0.04*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={n}:s=1920x1080:fps={FPS},"
              f"fade=in:st=0:d={FADE},fade=out:st={target - FADE}:d={FADE}")
        cmd = ["ffmpeg", "-v", "error", "-y", "-loop", "1", "-i", f"{K}/{name}.png", "-vf", vf, "-t", str(target), *enc, out]
    else:
        src = f"{C}/{name}.mp4"; d = dur(src); speed = max(1.0, d / target); L = d / speed
        cap = f"{K}/cap-{name}.png"
        fc = (f"[0:v]setpts=PTS/{speed:.4f},fps={FPS}[v];"
              f"[1:v]format=rgba,fade=in:st=0.5:d=0.4:alpha=1[c];"
              f"[v][c]overlay=0:0:shortest=0:eof_action=repeat,fade=in:st=0:d={FADE},fade=out:st={L - FADE:.3f}:d={FADE}[o]")
        cmd = ["ffmpeg", "-v", "error", "-y", "-i", src, "-loop", "1", "-t", f"{L:.3f}", "-i", cap,
               "-filter_complex", fc, "-map", "[o]", "-t", f"{L:.3f}", *enc, out]
        print(f"  {name}: {d:.1f}s -> {L:.1f}s (x{speed:.2f})")
    subprocess.run(cmd, check=True)
with open(f"{T}/list.txt", "w") as f: f.write("".join(f"file '{p}'\n" for p in parts))
final = f"{D}/kalypso-demo.mp4"
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", f"{T}/list.txt",
                "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-shortest", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
                "-movflags", "+faststart", final], check=True)
print(final, f"{dur(final):.1f}s", f"{os.path.getsize(final) / 1e6:.1f} MB")
