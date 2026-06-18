import base64
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

_TEMPLATES_DIR = Path(__file__).parent.parent.parent / "templates"
_LOGO_PATH = Path(__file__).parent.parent.parent.parent / "frontend" / "public" / "udyogi-logo.png"


def _logo_b64() -> str:
    try:
        data = _LOGO_PATH.read_bytes()
        return "data:image/png;base64," + base64.b64encode(data).decode()
    except Exception:
        return ""

_ONES = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def _words_below_hundred(n: int) -> str:
    if n < 20:
        return _ONES[n]
    tens = _TENS[n // 10]
    ones = _ONES[n % 10]
    return f"{tens} {ones}".strip() if ones else tens


def _words_below_thousand(n: int) -> str:
    if n < 100:
        return _words_below_hundred(n)
    h = _ONES[n // 100]
    rest = _words_below_hundred(n % 100)
    return f"{h} Hundred {rest}".strip() if rest else f"{h} Hundred"


def num_to_words(amount: int) -> str:
    """Convert an integer rupee amount to Indian-English words (e.g. 8493 → 'Eight Thousand Four Hundred Ninety Three Only')."""
    if amount == 0:
        return "Zero Only"
    parts = []
    crore = amount // 10_000_000
    if crore:
        parts.append(f"{_words_below_thousand(crore)} Crore")
        amount %= 10_000_000
    lakh = amount // 100_000
    if lakh:
        parts.append(f"{_words_below_thousand(lakh)} Lakh")
        amount %= 100_000
    thousand = amount // 1000
    if thousand:
        parts.append(f"{_words_below_thousand(thousand)} Thousand")
        amount %= 1000
    if amount:
        parts.append(_words_below_thousand(amount))
    return " ".join(parts) + " Only"


def generate_pdf(context: dict) -> bytes:
    """Render payslip_template.html with Jinja2 and convert to PDF bytes via WeasyPrint."""
    try:
        from weasyprint import HTML as WeasyHTML  # lazy import; needs pango/cairo at runtime
    except OSError as exc:
        raise RuntimeError(
            "WeasyPrint could not load system libraries (pango/cairo). "
            "Install them via brew (macOS) or apt (Debian) and retry. "
            f"Details: {exc}"
        ) from exc

    env = Environment(loader=FileSystemLoader(str(_TEMPLATES_DIR)))
    template = env.get_template("payslip_template.html")
    html_string = template.render(**context, logo_b64=_logo_b64())
    return WeasyHTML(string=html_string, base_url=str(_TEMPLATES_DIR)).write_pdf()
