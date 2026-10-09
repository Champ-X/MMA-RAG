# Synthetic connection-test video

`connection.mp4` is an original generated 2-second, 128×128 H.264/AAC test clip: red for one second, blue for one second, and a 440 Hz tone. It contains no personal data. It is bundled so a connection test does not require `ffmpeg` at runtime.

Reproduce with:

```sh
ffmpeg -hide_banner -loglevel error -f lavfi -i 'color=c=red:s=128x128:d=1:r=4' -f lavfi -i 'color=c=blue:s=128x128:d=1:r=4' -f lavfi -i 'sine=frequency=440:duration=2' -filter_complex '[0:v][1:v]concat=n=2:v=1:a=0[v]' -map '[v]' -map 2:a -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart -shortest connection.mp4
```
