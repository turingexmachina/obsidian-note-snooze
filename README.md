# obsidian-note-snooze

Hide notes from the file explorer until a date specified in a frontmatter property.

## Install

### From the Community Plugins browser

1. In Obsidian, open **Settings → Community plugins → Browse**.
2. Search for `Note Snooze`.
3. Select **Install**, then **Enable**.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the
   [latest release](https://github.com/turingexmachina/obsidian-note-snooze/releases).
2. Copy them into `<your-vault>/.obsidian/plugins/note-snooze/`.
3. Reload Obsidian and enable **Note Snooze** under
   **Settings → Community plugins**.

### From source

The Node.js version is pinned via [mise](https://mise.jdx.dev); run
`mise install` first if you have it, otherwise use the Node version in
[.mise.toml](.mise.toml) directly.

```sh
git clone https://github.com/turingexmachina/obsidian-note-snooze.git
cd obsidian-note-snooze
npm install
npm run build
```

Then copy `main.js`, `manifest.json`, and `styles.css` into
`<your-vault>/.obsidian/plugins/note-snooze/`.

## Usage

Add the property to a note's frontmatter:

```yaml
---
hidden-until: 2026-08-01
---
```

The note disappears from the file explorer until 2026-08-01 (local time), then reappears automatically — no reload needed.

## Settings

- **Hidden-until property** — the frontmatter property name to check. Defaults to `hidden-until`.

## Notes

- Only the file explorer is affected. The note is otherwise unchanged: still searchable, still openable via Quick Switcher/links, still fully readable.
- Missing property, empty value, or an unparseable date all mean "not hidden".
- Accepts plain dates (`2026-08-01`) as well as full datetimes.

## Contributing

Questions and bug reports are welcome via GitHub Issues on this repository. Pull requests are welcome too.

## License

[MIT](LICENSE) © turingexmachina
