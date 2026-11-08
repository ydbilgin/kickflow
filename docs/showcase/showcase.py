#!/usr/bin/env python3
"""Regenerate the README showcase blocks and the banner / social-preview art from docs/showcase/showcase.yml.

Content lives in showcase.yml; design lives in docs/showcase/templates/ (one <block>.md per README block,
one or more *.svg art templates). See docs/showcase/UPDATING.md.

Usage (from the repository root):
    python3 docs/showcase/showcase.py            # rewrite README blocks and SVGs; render PNGs for changed SVGs
    python3 docs/showcase/showcase.py --png      # also re-render every PNG
    python3 docs/showcase/showcase.py --no-png   # skip the PNG step
    python3 docs/showcase/showcase.py --check    # exit 1 if README blocks or SVGs are out of date (used by CI)
    python3 docs/showcase/showcase.py --context  # print the data templates can use

Python 3.8+ standard library only. showcase.yml is read with a small built-in reader that understands a
strict YAML subset: nested mappings, lists ("- "), plain or quoted scalars, '|' and '>' block scalars and
'#' comments. Anchors, flow collections ({...} / [...]) and multi-document files are not supported.
"""
import base64
import html
import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
CONFIG = os.path.join(HERE, "showcase.yml")


# --------------------------------------------------------------------------- YAML subset reader
class YamlError(ValueError):
    pass


def _strip_comment(line):
    out, quote = [], None
    for i, ch in enumerate(line):
        if quote:
            if ch == quote:
                quote = None
        elif ch in "\"'" and (i == 0 or line[i - 1] in " :-\t["):
            quote = ch
        elif ch == "#" and (i == 0 or line[i - 1] in " \t"):
            break
        out.append(ch)
    return "".join(out).rstrip()


def _scalar(text):
    t = text.strip()
    if not t:
        return None
    if t[0] == '"' and t[-1] == '"' and len(t) >= 2:
        return re.sub(r'\\(["\\nt])', lambda m: {"n": "\n", "t": "\t"}.get(m.group(1), m.group(1)), t[1:-1])
    if t[0] == "'" and t[-1] == "'" and len(t) >= 2:
        return t[1:-1].replace("''", "'")
    if t in ("true", "True"):
        return True
    if t in ("false", "False"):
        return False
    if t in ("null", "~"):
        return None
    if t[0] in "[{&*!|>":
        raise YamlError("unsupported YAML construct: %r" % t)
    return t


def load_yaml(text):
    raw = text.split("\n")
    lines = []  # (indent, content, raw_line_index)
    for n, line in enumerate(raw):
        if "\t" in line[: len(line) - len(line.lstrip())]:
            raise YamlError("line %d: tabs are not allowed for indentation" % (n + 1))
        stripped = _strip_comment(line)
        if stripped.strip():
            lines.append((len(stripped) - len(stripped.lstrip()), stripped.strip(), n))
    pos = [0]

    def block_scalar(style, parent_indent, n):
        body, indent = [], None
        i = n + 1
        while i < len(raw):
            line = raw[i]
            if line.strip():
                ind = len(line) - len(line.lstrip())
                if ind <= parent_indent:
                    break
                indent = ind if indent is None else indent
                body.append(line[indent:])
            else:
                body.append("")
            i += 1
        while pos[0] < len(lines) and lines[pos[0]][2] < i:
            pos[0] += 1
        while body and not body[-1]:
            body.pop()
        if style == "|":
            return "\n".join(body)
        paras, cur = [], []
        for b in body:
            if b:
                cur.append(b.strip())
            else:
                paras.append(" ".join(cur))
                cur = []
        paras.append(" ".join(cur))
        return "\n".join(p for p in paras)

    def parse_value(rest, indent, n):
        rest = rest.strip()
        if rest in ("|", ">", "|-", ">-"):
            return block_scalar(rest[0], indent, n)
        if rest:
            return _scalar(rest)
        if pos[0] < len(lines) and lines[pos[0]][0] > indent:
            return parse_node(lines[pos[0]][0])
        if pos[0] < len(lines) and lines[pos[0]][0] == indent and lines[pos[0]][1].startswith("- "):
            return parse_node(indent)
        return None

    def parse_map_entry(content, indent, n, target):
        m = re.match(r'^("[^"]*"|\'[^\']*\'|[^:]+?)\s*:(\s+(.*)|)$', content)
        if not m:
            raise YamlError("line %d: expected 'key: value'" % (n + 1))
        key = _scalar(m.group(1))
        if key in target:
            raise YamlError("line %d: duplicate key %r" % (n + 1, key))
        target[key] = parse_value(m.group(3) or "", indent, n)

    def parse_node(indent):
        first = lines[pos[0]][1]
        if first.startswith("- ") or first == "-":
            result = []
            while pos[0] < len(lines) and lines[pos[0]][0] == indent and (lines[pos[0]][1].startswith("- ") or lines[pos[0]][1] == "-"):
                ind, content, n = lines[pos[0]]
                pos[0] += 1
                item = content[1:].strip()
                if not item:
                    result.append(parse_value("", ind, n))
                elif re.match(r'^("[^"]*"|\'[^\']*\'|[^:"\']+?)\s*:(\s|$)', item):
                    obj = {}
                    child_indent = ind + 2
                    parse_map_entry(item, child_indent, n, obj)
                    while pos[0] < len(lines) and lines[pos[0]][0] == child_indent and not lines[pos[0]][1].startswith("- "):
                        _, c, nn = lines[pos[0]]
                        pos[0] += 1
                        parse_map_entry(c, child_indent, nn, obj)
                    result.append(obj)
                else:
                    result.append(_scalar(item))
            return result
        result = {}
        while pos[0] < len(lines) and lines[pos[0]][0] == indent:
            _, content, n = lines[pos[0]]
            if content.startswith("- "):
                raise YamlError("line %d: unexpected list item" % (n + 1))
            pos[0] += 1
            parse_map_entry(content, indent, n, result)
        if pos[0] < len(lines) and lines[pos[0]][0] > indent:
            raise YamlError("line %d: unexpected indentation" % (lines[pos[0]][2] + 1))
        return result

    if not lines:
        return {}
    data = parse_node(lines[0][0])
    if pos[0] != len(lines):
        raise YamlError("line %d: could not parse" % (lines[pos[0]][2] + 1))
    return data


# --------------------------------------------------------------------------- helpers
def esc(t):
    return html.escape("" if t is None else str(t), quote=True)


def cell(t):
    return esc(t).replace("|", "\\|").replace("\n", " ").strip()


def data_uri(path):
    full = os.path.join(ROOT, path)
    ext = os.path.splitext(path)[1].lower()
    mime = {".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".gif": "image/gif", ".webp": "image/webp"}.get(ext)
    if not mime:
        sys.exit("showcase: cannot embed %s (use png, svg, jpg, gif or webp)" % path)
    with open(full, "rb") as f:
        return "data:%s;base64,%s" % (mime, base64.b64encode(f.read()).decode("ascii"))


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-")


def num(x):
    return str(int(x)) if float(x).is_integer() else "%.1f" % x


WARNINGS = []


def warn(msg):
    if msg not in WARNINGS:
        WARNINGS.append(msg)


# --------------------------------------------------------------------------- mustache-style templates
# {{name}} (HTML-escaped), {{name|raw}}, {{name|cell}} (for Markdown table cells), {{name|url}},
# {{{name}}} (raw), {{#name}}...{{/name}} (list loop / truthy block), {{^name}}...{{/name}} (if empty),
# {{! comment}}, {{.}} (current item), dotted names (hero.media). A section or comment tag that stands
# alone on its line removes that whole line, so templates can be laid out readably.
TAG = re.compile(r"\{\{\{\s*(.+?)\s*\}\}\}|\{\{\s*([#^/!&]?)\s*(.*?)\s*\}\}", re.S)
STANDALONE = re.compile(r"^[ \t]*(\{\{[#^/!][^}]*\}\})[ \t]*\n", re.M)


def parse_template(text, where):
    text = STANDALONE.sub(r"\1", text)
    root, stack, pos = [], [], 0
    cur = root
    for m in TAG.finditer(text):
        if m.start() > pos:
            cur.append(("text", text[pos:m.start()]))
        pos = m.end()
        if m.group(1) is not None:
            cur.append(("var", m.group(1) + "|raw"))
            continue
        kind, name = m.group(2), m.group(3)
        if kind == "!":
            continue
        if kind in "#^" and kind:
            node = ("section" if kind == "#" else "inverted", name, [])
            cur.append(node)
            stack.append((node, cur))
            cur = node[2]
        elif kind == "/":
            if not stack or stack[-1][0][1] != name:
                sys.exit("%s: unexpected {{/%s}}" % (where, name))
            cur = stack.pop()[1]
        else:
            cur.append(("var", name + ("|raw" if kind == "&" else "")))
    if stack:
        sys.exit("%s: unclosed {{#%s}}" % (where, stack[-1][0][1]))
    if pos < len(text):
        cur.append(("text", text[pos:]))
    return root


def lookup(name, ctx):
    if name == ".":
        return ctx[-1]
    first, *rest = name.split(".")
    for frame in reversed(ctx):
        if isinstance(frame, dict) and first in frame:
            val = frame[first]
            break
    else:
        return None
    for part in rest:
        val = val.get(part) if isinstance(val, dict) else None
    return val


FILTERS = {
    "html": esc,
    "raw": lambda v: "" if v is None else str(v),
    "cell": cell,
    "url": lambda v: esc(str(v or "").replace(" ", "%20")),
}


def render_nodes(nodes, ctx):
    out = []
    for node in nodes:
        if node[0] == "text":
            out.append(node[1])
        elif node[0] == "var":
            name, _, flt = node[1].partition("|")
            val = lookup(name.strip(), ctx)
            if isinstance(val, bool):
                val = "true" if val else ""
            out.append(FILTERS[(flt or "html").strip()](val))
        else:
            val = lookup(node[1], ctx)
            empty = val in (None, False, "", [], {})
            if node[0] == "inverted":
                if empty:
                    out.append(render_nodes(node[2], ctx))
            elif not empty:
                items = val if isinstance(val, list) else [val]
                for item in items:
                    out.append(render_nodes(node[2], ctx + [item]))
    return "".join(out)


def render(text, ctx, where="template"):
    return render_nodes(parse_template(text, where), ctx if isinstance(ctx, list) else [ctx])


# --------------------------------------------------------------------------- template directives
# A template may start with directive lines, ended by a line "---":
#   @wrap PATH chars=N lines=N line_height=N (top=Y | center=Y | bottom=Y)
#       PATH is "field" or "list.field". Adds FIELD_lines (each {text, y, first, last}), FIELD_line_count and
#       FIELD_truncated. Text longer than the allowed lines is cut at a word with an ellipsis (and warned about).
#   @grid LIST columns=3,2 [fill=false]
#       Adds LIST_rows (each {cells}), LIST_columns and LIST_cell_width. Picks the column count that leaves the
#       fewest empty cells (ties: the first listed) and pads the last row with {filler: true} cells.
#   @out PATH            (SVG templates) where to write; may use {{slug}} / {{variant}}
#   @png PATH WxH        (SVG templates) also render a PNG of that size
#   @each LIST           (SVG templates) render once per item of LIST (the item's fields are in scope)
#   @variant NAME k=v .. (SVG templates) render once per variant with those values (e.g. light / dark cards)
def split_directives(text, where):
    if not text.startswith("@"):
        return [], text
    head, sep, body = text.partition("\n---\n")
    if not sep:
        sys.exit("%s: directive lines must end with a line '---'" % where)
    out = []
    for line in head.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        args, opts = [], {}
        for p in parts[1:]:
            if "=" in p and not p.startswith("{{"):
                k, v = p.split("=", 1)
                opts[k] = v
            else:
                args.append(p)
        out.append((parts[0][1:], args, opts))
    return out, body


def wrap_lines(text, chars, lines):
    words = textwrap.wrap(str(text or ""), chars)
    if len(words) <= lines:
        return words, False
    kept = words[:lines]
    last = " ".join(words[lines - 1:])
    cut = textwrap.wrap(last, chars - 1)[0]
    kept[-1] = cut.rstrip(" ,.;:-") + "…"
    return kept, True


def apply_wrap(ctx, path, opts, where):
    chars, lines = int(opts.get("chars", 40)), int(opts.get("lines", 2))
    lh = float(opts.get("line_height", 20))
    if "." in path:
        lst, field = path.split(".", 1)
        targets = [t for t in (ctx.get(lst) or []) if isinstance(t, dict)]
    else:
        field, targets = path, [ctx]
    for t in targets:
        got, cut = wrap_lines(t.get(field), chars, lines)
        if cut:
            warn("%s: '%s' was shortened to fit %d lines: %r" % (where, field, lines, t.get(field)))
        n = len(got)
        if "center" in opts:
            y0 = float(opts["center"]) - (n - 1) * lh / 2
        elif "bottom" in opts:
            y0 = float(opts["bottom"]) - (n - 1) * lh
        else:
            y0 = float(opts.get("top", 0))
        t[field + "_lines"] = [{"text": s, "y": num(y0 + i * lh), "first": i == 0, "last": i == n - 1} for i, s in enumerate(got)]
        t[field + "_line_count"] = str(n)
        t[field + "_truncated"] = cut


def apply_grid(ctx, name, opts):
    items = [i for i in (ctx.get(name) or [])]
    choices = [int(c) for c in opts.get("columns", "3,2").split(",")]
    n = len(items)
    cols = min(choices, key=lambda c: ((-n) % c, choices.index(c))) if n else choices[0]
    cols = min(cols, max(n, 1))
    rows = []
    for i in range(0, n, cols):
        cells = list(items[i:i + cols])
        if opts.get("fill", "true") != "false":
            cells += [{"filler": True}] * (cols - len(cells))
        rows.append({"cells": cells})
    ctx[name + "_rows"] = rows
    ctx[name + "_columns"] = str(cols)
    ctx[name + "_cell_width"] = str(100 // cols)


# --------------------------------------------------------------------------- context
def enrich(node):
    """Add slug, index, first/last and *_data (embedded images) to every mapping, recursively."""
    if isinstance(node, dict):
        for k in list(node.keys()):
            v = node[k]
            if (k == "icon" or k.endswith("_icon")) and isinstance(v, str) and v:
                node[k + "_data"] = data_uri(v)
            enrich(v)
        if "slug" not in node:
            key = node.get("name") or node.get("file") or node.get("label")
            if key:
                node["slug"] = slug(os.path.splitext(os.path.basename(str(key)))[0] if node.get("file") and not node.get("name") else key)
    elif isinstance(node, list):
        for i, item in enumerate(node):
            if isinstance(item, dict):
                item.setdefault("index", str(i + 1))
                item["first"], item["last"] = i == 0, i == len(node) - 1
            enrich(item)


def load_config():
    with open(CONFIG, encoding="utf-8") as f:
        c = load_yaml(f.read())
    for key in ("name", "tagline"):
        if not c.get(key):
            sys.exit("showcase.yml: '%s' is required" % key)
    enrich(c)
    return c


def prepared(c, directives, where):
    import copy
    ctx = copy.deepcopy(c)
    for name, args, opts in directives:
        if name == "wrap":
            apply_wrap(ctx, args[0], opts, where)
        elif name == "grid":
            apply_grid(ctx, args[0], opts)
    return ctx


# --------------------------------------------------------------------------- README blocks and art
TEMPLATES = os.path.join(HERE, "templates")
MARKER = re.compile(r"(<!-- showcase:([\w-]+):start[^>]*-->\n)(.*?)(<!-- showcase:\2:end -->)", re.S)


def render_block(name, c):
    path = os.path.join(TEMPLATES, name + ".md")
    if not os.path.exists(path):
        sys.exit("README uses block '%s' but docs/showcase/templates/%s.md does not exist" % (name, name))
    with open(path, encoding="utf-8") as f:
        directives, body = split_directives(f.read(), "templates/%s.md" % name)
    ctx = prepared(c, directives, "templates/%s.md" % name)
    text = render(body, ctx, "templates/%s.md" % name)
    text = re.sub(r"\n{3,}", "\n\n", text).strip("\n")
    return text + "\n" if text else ""


def render_readme(text, c):
    return MARKER.sub(lambda m: m.group(1) + render_block(m.group(2), c) + m.group(4), text)


def art_outputs(c):
    files, pngs = {}, []
    if not os.path.isdir(TEMPLATES):
        return files, pngs
    for fn in sorted(os.listdir(TEMPLATES)):
        if not fn.endswith(".svg"):
            continue
        where = "templates/" + fn
        with open(os.path.join(TEMPLATES, fn), encoding="utf-8") as f:
            directives, body = split_directives(f.read(), where)
        out = [a for d, a, _ in directives if d == "out"]
        if not out:
            sys.exit("%s: needs an '@out PATH' line" % where)
        png = [a for d, a, _ in directives if d == "png"]
        each = [a[0] for d, a, _ in directives if d == "each"]
        variants = [(a[0], o) for d, a, o in directives if d == "variant"] or [("", {})]
        base = prepared(c, directives, where)
        items = base.get(each[0]) or [] if each else [{}]
        tree = parse_template(body, where)
        for item in items:
            for vname, vals in variants:
                frame = dict(vals, variant=vname)
                ctx = [base, item, frame]
                path = render(out[0][0], ctx, where)
                svg = render_nodes(tree, ctx)
                if path in files:
                    sys.exit("%s: two renders write %s (add {{slug}} or {{variant}} to @out)" % (where, path))
                files[path] = svg
                if png:
                    w, h = (int(x) for x in png[0][1].lower().split("x"))
                    pngs.append((path, render(png[0][0], ctx, where), w, h))
    return files, pngs


def find_browser():
    names = ["chromium", "chromium-browser", "google-chrome", "chrome", "msedge", "microsoft-edge"]
    for n in names:
        p = shutil.which(n)
        if p:
            return p
    for p in (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
              r"C:\Program Files\Google\Chrome\Application\chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"):
        if os.path.exists(p):
            return p
    env = os.environ.get("SHOWCASE_BROWSER")
    return env if env and os.path.exists(env) else None


PLAYWRIGHT_JS = """
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [svg, png, w, h] = process.argv.slice(1);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: +w, height: +h } });
  await p.setContent('<html><body style="margin:0">' + fs.readFileSync(svg, 'utf8') + '</body></html>');
  await p.screenshot({ path: png, clip: { x: 0, y: 0, width: +w, height: +h } });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
"""


def _try(cmd, **kw):
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90, **kw)
        return True
    except (subprocess.SubprocessError, OSError):
        return False


def rasterise(svg_rel, png_rel, w, h):
    """SVG -> PNG with whatever is available: rsvg-convert, Node + Playwright, or headless Chrome/Edge."""
    svg, png = os.path.join(ROOT, svg_rel), os.path.join(ROOT, png_rel)
    if shutil.which("rsvg-convert") and _try(["rsvg-convert", "-w", str(w), "-h", str(h), "-o", png, svg]):
        return "rsvg-convert"
    if shutil.which("node"):
        env = dict(os.environ)
        npm = shutil.which("npm")
        if npm:
            try:
                root = subprocess.run([npm, "root", "-g"], capture_output=True, text=True, timeout=30).stdout.strip()
                env["NODE_PATH"] = os.pathsep.join(p for p in (env.get("NODE_PATH"), root) if p)
            except (subprocess.SubprocessError, OSError):
                pass
        if _try(["node", "-e", PLAYWRIGHT_JS, svg, png, str(w), str(h)], env=env):
            return "node + playwright"
    browser = find_browser()
    if browser:
        with tempfile.TemporaryDirectory() as tmp:
            page = os.path.join(tmp, "page.html")
            with open(svg, encoding="utf-8") as f:
                body = f.read()
            with open(page, "w", encoding="utf-8") as f:
                f.write('<!doctype html><html><body style="margin:0;overflow:hidden">%s</body></html>' % body)
            ok = _try([browser, "--headless", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
                       "--user-data-dir=" + os.path.join(tmp, "profile"), "--window-size=%d,%d" % (w, h),
                       "--screenshot=" + os.path.abspath(png), "file:///" + page.replace("\\", "/").lstrip("/")])
        if ok and os.path.exists(png):
            return os.path.basename(browser)
    return None


# --------------------------------------------------------------------------- main
def main(argv):
    check = "--check" in argv
    c = load_config()
    if "--context" in argv:
        import json
        def strip(v):
            if isinstance(v, dict):
                return {k: strip(x) for k, x in v.items() if not k.endswith("_data")}
            return [strip(x) for x in v] if isinstance(v, list) else v
        print(json.dumps(strip(c), indent=2, ensure_ascii=False))
        return 0
    stale = []
    for readme in c.get("readmes") or ["README.md"]:
        path = os.path.join(ROOT, readme)
        with open(path, encoding="utf-8") as f:
            old = f.read()
        new = render_readme(old, c)
        if new != old:
            stale.append(readme)
            if not check:
                with open(path, "w", encoding="utf-8", newline="\n") as f:
                    f.write(new)
    files, pngs = art_outputs(c)
    for rel, text in files.items():
        path = os.path.join(ROOT, rel)
        old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
        if old != text:
            stale.append(rel)
            if not check:
                os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
                with open(path, "w", encoding="utf-8", newline="\n") as f:
                    f.write(text)
    for w in WARNINGS:
        print("warning: " + w)
    if check:
        if stale:
            print("Out of date with docs/showcase/showcase.yml: " + ", ".join(stale))
            print("Run: python3 docs/showcase/showcase.py   and commit the result.")
            return 1
        print("Showcase is in sync with docs/showcase/showcase.yml.")
        return 0
    for rel in stale:
        print("updated " + rel)
    if "--no-png" not in argv:
        for svg_rel, png_rel, w, h in pngs:
            if svg_rel not in stale and os.path.exists(os.path.join(ROOT, png_rel)) and "--png" not in argv:
                continue
            tool = rasterise(svg_rel, png_rel, w, h)
            print(("rendered %s with %s" % (png_rel, tool)) if tool else
                  "skipped %s: no renderer found (install rsvg-convert, or Chrome/Edge, or set SHOWCASE_BROWSER)" % png_rel)
    if not stale:
        print("Nothing to update.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
