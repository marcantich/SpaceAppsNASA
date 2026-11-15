# presentation/ — the pitch

**The pitch slides** (7 slides, PowerPoint, 127 MB) are too large for the repository (GitHub refuses
files over 100 MB), so they are attached to the GitHub release `pitch`:

- Download: https://github.com/pablourioste/SpaceAppsNASA/releases/download/pitch/Earth_Analog_Presentation.pptx
- Release page: https://github.com/pablourioste/SpaceAppsNASA/releases/tag/pitch

The release only holds the slides; it is not a version of the app. A local copy can be kept in
`slides/`: `.pptx` files there are ignored by git (`.gitignore`). To publish a new version of the deck,
replace the file in the release:

```bash
gh release upload pitch presentation/slides/Earth_Analog_Presentation.pptx --clobber
```

Other folders:
- `video/` — the demo video goes here if one is made (`.mp4` / `.mov` files are not committed: share them
  through the team drive). A video demo is limited to 30 seconds, with English subtitles.
- `assets/` — screenshots, logos and images.
