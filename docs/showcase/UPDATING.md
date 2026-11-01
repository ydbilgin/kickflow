# Updating the README showcase

Content and design are kept apart:

- `docs/showcase/showcase.yml` holds content only: text, feature entries, comparison rows, media paths, badges.
- `docs/showcase/templates/` holds the design: `<block>.md` for each generated README block and `*.svg` for the
  banner / social-preview art. These were designed by hand; change them only when you want a new look.

To add or remove a feature, screenshot, badge or comparison row:

1. Edit `docs/showcase/showcase.yml`.
2. Run `python3 docs/showcase/showcase.py` from the repository root (Python 3.8+, standard library only).
   It rewrites the README parts between `<!-- showcase:NAME:start -->` and `<!-- showcase:NAME:end -->`
   (from `templates/NAME.md`) and the SVG art, and renders PNGs if it finds `rsvg-convert`, Node with
   Playwright, or Chrome/Edge (`SHOWCASE_BROWSER=<path>` picks one). It warns when a text had to be shortened.
3. Look at the result (GitHub preview, or open the PNGs), then commit the YAML with the regenerated files.
   CI runs `python3 docs/showcase/showcase.py --check` and fails if the README blocks or SVGs drift from the YAML.

Text outside the markers is hand-written and never touched. Do not edit inside the markers.
`python3 docs/showcase/showcase.py --context` prints the data the templates can use.

Template syntax (Mustache-style): `{{name}}` (escaped), `{{name|cell}}` (Markdown table cell), `{{{name}}}` (raw),
`{{#list}}…{{/list}}`, `{{^name}}…{{/name}}` (when empty), `{{.}}`, dotted names. Optional directive lines at the top
of a template, ended by `---`: `@wrap FIELD chars= lines= line_height= top=|center=|bottom=` (wrapped lines with
y positions, ellipsis if too long), `@grid LIST columns=3,2` (balanced rows, fewest empty cells), and for SVG art
`@out PATH`, `@png PATH WxH`, `@each LIST`, `@variant NAME key=value …`. The YAML reader supports a strict subset:
mappings, `- ` lists, plain or quoted values, `|` / `>` blocks and `#` comments (no `{}` / `[]` inline collections).
