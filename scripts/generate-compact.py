"""Generate AST-verified compact SkillGuard contract for Bradbury L2 gas limit compliance."""

import ast
import hashlib
import io
import json
from pathlib import Path
import tokenize


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "contracts" / "skill_guard.py"
OUTPUT = ROOT / "contracts" / "skill_guard_compact.py"
IGNORED_TOKEN_TYPES = {
    tokenize.ENCODING,
    tokenize.NL,
    tokenize.NEWLINE,
    tokenize.INDENT,
    tokenize.DEDENT,
    tokenize.ENDMARKER,
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# 移除模块、类、函数顶部的 docstring，保持运行语义完全一致
def strip_docstrings(tree: ast.AST) -> ast.AST:
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            if (
                node.body
                and isinstance(node.body[0], ast.Expr)
                and isinstance(node.body[0].value, ast.Constant)
                and isinstance(node.body[0].value.value, str)
            ):
                node.body = node.body[1:] or [ast.Pass()]
    return tree


def pair_tokens(value: str):
    result = []
    reader = tokenize.generate_tokens(io.StringIO(value).readline)
    try:
        for token in reader:
            if token.type not in IGNORED_TOKEN_TYPES:
                result.append((token.type, token.string))
    except (tokenize.TokenError, IndentationError, SyntaxError):
        pass
    return result


def build_compact(raw: bytes) -> bytes:
    runner_lines = raw.splitlines(keepends=True)[:2]
    original = raw.decode("utf-8")
    parsed = strip_docstrings(ast.parse(original, type_comments=True))
    unparsed = ast.unparse(parsed)

    lines, line, previous, indent = [], "", None, 0
    for token in tokenize.generate_tokens(io.StringIO(unparsed).readline):
        kind, value = token.type, token.string
        if kind == tokenize.INDENT:
            indent = len(value) // 4
        elif kind == tokenize.DEDENT:
            indent -= 1
        elif kind == tokenize.NEWLINE:
            if line:
                lines.append(line)
            line, previous = "", None
        elif kind not in {tokenize.NL, tokenize.ENDMARKER, tokenize.ENCODING, tokenize.COMMENT}:
            if not line:
                line = " " * indent
            needs_space = previous is not None and (
                (previous[0] == tokenize.NUMBER and kind == tokenize.NAME)
                or pair_tokens(previous[1] + value) != [previous, (kind, value)]
            )
            if needs_space:
                line += " "
            line += value
            previous = (kind, value)
    if line:
        lines.append(line)

    compact = b"".join(runner_lines) + ("\n".join(lines) + "\n").encode("utf-8")
    tree_a = ast.dump(strip_docstrings(ast.parse(original, type_comments=True)), include_attributes=False)
    tree_b = ast.dump(ast.parse(compact.decode("utf-8"), type_comments=True), include_attributes=False)
    if tree_a != tree_b:
        raise ValueError("AST mismatch between canonical and compact contract")
    return compact


def main():
    raw = SOURCE.read_bytes()
    compact = build_compact(raw)
    OUTPUT.write_bytes(compact)
    info = {
        "canonical_source": "contracts/skill_guard.py",
        "canonical_sha256": sha256(raw),
        "canonical_bytes": len(raw),
        "compact_source": "contracts/skill_guard_compact.py",
        "compact_sha256": sha256(compact),
        "compact_bytes": len(compact),
        "ast_equivalent": True,
    }
    (ROOT / "artifacts" / "compact-build.json").write_text(
        json.dumps(info, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(info))


if __name__ == "__main__":
    main()
