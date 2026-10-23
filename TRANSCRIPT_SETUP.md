# Optional transcript support

The analyser attempts to fetch publicly available YouTube transcripts when the optional `youtube-transcript-api` package is installed. If the package is missing, or a video has no accessible transcript, the channel metadata analysis continues and transcript-dependent scores stay unavailable rather than being guessed.

From the project root with the virtual environment activated:

```bash
pip install youtube-transcript-api
```

Restart Flask after installing. Transcript availability varies by video, region, captions, and library/API changes; this is best-effort, not guaranteed. Review the package's current usage and YouTube's applicable terms before production deployment.
