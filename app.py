from flask import Flask, render_template_string, request, send_from_directory, abort, Response
import os, json, io, socket, hashlib
from threading import Thread
import qrcode

# Explicitly set static folder (defaults are fine, but this makes it clear)
app = Flask(__name__, static_folder="static", static_url_path="/static")
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

@app.template_filter('commaformat')
def commaformat(value):
    try:
        return f"{int(value):,}"
    except Exception:
        return value

# ===== Image serving configuration =====
# These are the only roots from which we will serve files via /media.
# Add/remove roots to match where your images actually live.
ALLOWED_IMAGE_ROOTS = [
    os.path.join(BASE_DIR, "static"),           # e.g., static/photos/house1.png
    os.path.join(BASE_DIR, "houses"),           # if you store images under houses/...
    os.path.expanduser("~/Downloads"),          # your Downloads (macOS/Linux)
    os.path.expanduser("~/Pictures"),           # your Pictures (macOS/Linux)
]

PLACEHOLDER_URL = "/static/photos/placeholder.jpg"  # make sure this file exists


def _realpath(p: str) -> str:
    return os.path.realpath(os.path.expanduser(p))


def _is_subpath(child: str, parent: str) -> bool:
    """Return True if realpath(child) lies within realpath(parent)."""
    try:
        return os.path.commonpath([_realpath(child), _realpath(parent)]) == _realpath(parent)
    except Exception:
        return False


def resolve_image_url(path: str) -> str:
    """
    Convert any image path in JSON to a browser-servable URL:
      - http(s) URLs are returned as-is
      - /static/... returned if file exists, else placeholder
      - absolute/tilde/relative filesystem paths are mapped to /media/<root_id>/<relpath>
        if they exist under one of ALLOWED_IMAGE_ROOTS, else placeholder
    """
    if not path:
        return PLACEHOLDER_URL

    path = path.strip()

    # 1) External URL
    if path.startswith("http://") or path.startswith("https://") or path.startswith("data:"):
        return path

    # 2) Static path
    if path.startswith("/static/"):
        static_fs = os.path.join(BASE_DIR, path.lstrip("/"))
        return path if os.path.exists(static_fs) else PLACEHOLDER_URL

    # 3) Absolute or tilde-expansion path
    candidate = _realpath(path)

    # 4) Relative path: try to find under allowed roots
    if not os.path.isabs(candidate):
        # Try relative to static/photos first
        rel_under_static = os.path.join(BASE_DIR, "static", "photos", os.path.basename(path))
        if os.path.exists(rel_under_static):
            return f"/static/photos/{os.path.basename(path)}"
        # Try each allowed root by joining the relative piece
        for idx, root in enumerate(ALLOWED_IMAGE_ROOTS):
            joined = os.path.join(root, path)
            if os.path.exists(joined) and _is_subpath(joined, root):
                rel = os.path.relpath(joined, root).replace("\\", "/")
                return f"/media/{idx}/{rel}"
        # Not found anywhere
        return PLACEHOLDER_URL

    # 5) Absolute file: map it to an allowed root
    if os.path.exists(candidate):
        for idx, root in enumerate(ALLOWED_IMAGE_ROOTS):
            if _is_subpath(candidate, root):
                rel = os.path.relpath(candidate, root).replace("\\", "/")
                return f"/media/{idx}/{rel}"
        # Absolute path exists but not under allowed roots
        # You can add a print here to see where it lives:
        # print(f"[IMG] File exists but not under allowed roots: {candidate}")
        return PLACEHOLDER_URL

    # If we got here, file doesn't exist
    # print(f"[IMG] File not found: {candidate}")
    return PLACEHOLDER_URL


@app.route("/media/<int:root_id>/<path:relpath>")
def serve_media(root_id: int, relpath: str):
    """Serve files safely from pre-approved roots only."""
    if root_id < 0 or root_id >= len(ALLOWED_IMAGE_ROOTS):
        abort(404)
    root = ALLOWED_IMAGE_ROOTS[root_id]
    # Security: ensure relpath stays inside root
    fullpath = os.path.join(root, relpath)
    if not os.path.exists(fullpath) or not _is_subpath(fullpath, root):
        abort(404)
    # Serve the file from the root
    return send_from_directory(root, relpath)


# ---------- JSON helpers ----------
def load_json(file_path):
    try:
        with open(file_path, "r") as f:
            return json.load(f)
    except Exception as e:
        print(f"Error reading {file_path}: {e}")
        return {}


def load_all_json_from_folder(folder_path, ignore_details=True):
    """Load all JSON files from a folder, optionally skipping a 'details' subfolder."""
    data = []
    if os.path.exists(folder_path):
        for file in os.listdir(folder_path):
            full_path = os.path.join(folder_path, file)
            if ignore_details and os.path.isdir(full_path) and file.lower() == "details":
                continue
            if file.endswith(".json"):
                data.append(load_json(full_path))
    return data


def enrich_property(prop):
    """Deterministically add deal status, market value, last sold info, and key features."""
    pid = str(prop.get("id", "0"))
    h = int(hashlib.md5(pid.encode()).hexdigest(), 16)
    price = prop.get("price", 0) or 0

    deal_status = ["poor", "fair", "good", "great"][h % 4]

    mv_pct = 0.82 + ((h >> 4) % 37) / 100
    market_value = int(price * mv_pct)

    years_back = 1 + ((h >> 8) % 9)
    month_names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
    month = month_names[(h >> 12) % 12]
    year = 2026 - years_back
    sp_pct = 0.60 + ((h >> 16) % 35) / 100
    last_sold_price = int(price * sp_pct)
    last_sold_date = f"{month} {year}"

    all_features = [
        "Swimming pool", "Finished basement", "Solar panels",
        "Mountain views", "Ocean views", "City skyline views",
        "Close to elementary school", "Close to middle school",
        "Close to high school", "Near shopping center",
        "Easy freeway access", "Near public transit",
        "Wood-burning fireplace", "Dedicated home office",
        "Guest house / ADU", "Corner lot", "Quiet cul-de-sac",
        "Gated community", "Dog park nearby", "Golf course access",
        "New roof", "Updated HVAC", "Smart home features",
        "Walkable to dining", "Large backyard",
    ]
    n = len(all_features)
    i0 = h % n
    i1 = (h >> 8) % n
    i2 = (h >> 16) % n
    if i1 == i0: i1 = (i1 + 1) % n
    if i2 == i0 or i2 == i1: i2 = (i2 + 2) % n
    if i2 == i0: i2 = (i2 + 1) % n
    features = [all_features[i0], all_features[i1], all_features[i2]]

    days_on_market = 1 + ((h >> 20) % 180)

    return {**prop, "deal_status": deal_status, "market_value": market_value,
            "last_sold_price": last_sold_price, "last_sold_date": last_sold_date,
            "features": features, "days_on_market": days_on_market}


# ---------- Navbar ----------
def generate_navbar(active=""):
    return f"""
    <style>
      .navbar {{
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: #0f172a;
        padding: 0 48px;
        height: 68px;
        position: sticky;
        top: 0;
        z-index: 1000;
        box-shadow: 0 2px 12px rgba(0,0,0,0.3);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }}
      .navbar-brand {{
        display: flex;
        align-items: center;
        gap: 12px;
        color: #f8fafc;
        font-size: 18px;
        font-weight: 700;
        text-decoration: none;
        letter-spacing: -0.3px;
        white-space: nowrap;
      }}
      .navbar-brand span {{ color: #f59e0b; }}
      .navbar-links {{
        display: flex;
        align-items: center;
        gap: 4px;
      }}
      .navbar-links a {{
        color: #94a3b8;
        text-decoration: none;
        font-size: 14px;
        font-weight: 500;
        padding: 8px 16px;
        border-radius: 8px;
        transition: all 0.15s ease;
        white-space: nowrap;
      }}
      .navbar-links a:hover {{
        color: #f8fafc;
        background: rgba(255,255,255,0.08);
      }}
      .navbar-links a.active {{
        color: #f59e0b;
        background: rgba(245,158,11,0.12);
      }}
      @media (max-width: 640px) {{
        .navbar {{ padding: 0 20px; }}
        .navbar-brand {{ font-size: 15px; }}
        .navbar-links a {{ padding: 6px 10px; font-size: 13px; }}
      }}
    </style>
    <nav class="navbar">
      <a href="/" class="navbar-brand">
        <img src="/static/shelter-logo.png" alt="Shelter logo" style="height:42px;width:42px;object-fit:contain;border-radius:50%;flex-shrink:0;">
        <span style="position:relative;top:-1px;">Shelter</span>
      </a>
      <div class="navbar-links">
        <a href="/" class="{ 'active' if active=='home' else '' }">Home</a>
        <a href="/sale" class="{ 'active' if active=='sale' else '' }">For Sale</a>
        <a href="/rent" class="{ 'active' if active=='rent' else '' }">For Rent</a>
        <a href="/properties" class="{ 'active' if active=='properties' else '' }">All Properties</a>
        <a href="/contact" class="{ 'active' if active=='contact' else '' }">Contact</a>
      </div>
    </nav>
    """


_PWA_HEAD = """\
    <link rel="manifest" href="/static/manifest.json">
    <meta name="theme-color" content="#0f172a">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="Shelter">"""

_PWA_SW = """\
  <script>
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function() {
        navigator.serviceWorker.register('/sw.js').catch(function() {});
      });
    }
  </script>"""


def inject_navbar(template_content: str, active="") -> str:
    navbar_html = generate_navbar(active)
    if "</head>" in template_content:
        template_content = template_content.replace("</head>", f"{_PWA_HEAD}\n</head>", 1)
    if "</body>" in template_content:
        template_content = template_content.replace("</body>", f"{_PWA_SW}\n</body>", 1)
    if "<body>" in template_content:
        return template_content.replace("<body>", f"<body>{navbar_html}", 1)
    return navbar_html + template_content


# ---------- Template Rendering ----------
def render_external_template(folder, filename, active="", **context):
    filepath = os.path.join(BASE_DIR, folder, filename)
    if not os.path.exists(filepath):
        return f"Template {filepath} not found", 404
    with open(filepath, "r") as f:
        template = f.read()
    template = inject_navbar(template, active)
    return render_template_string(template, **context)


# ---------- Home ----------
@app.route('/')
def home():
    return render_external_template(
        "templates",
        "index.html",
        active="home"
    )

# ---------- Search ----------
@app.route('/search')
def search():
    state = request.args.get('state', '').strip()
    city = request.args.get('city', '').strip()
    if not state:
        return "State is required", 400

    state = state.title()
    city = city.title() if city else ""

    # Build list of (record, folder_city) tuples so each result knows its city
    raw_pairs = []
    if city:
        folder = os.path.join(BASE_DIR, "houses", state, city)
        for r in load_all_json_from_folder(folder, ignore_details=True):
            raw_pairs.append((r, city))
    else:
        # State-wide: walk every city subfolder
        state_folder = os.path.join(BASE_DIR, "houses", state)
        if os.path.exists(state_folder):
            for entry in sorted(os.listdir(state_folder)):
                entry_path = os.path.join(state_folder, entry)
                if os.path.isdir(entry_path) and not entry.startswith('.') and entry.lower() != 'details':
                    for r in load_all_json_from_folder(entry_path, ignore_details=True):
                        raw_pairs.append((r, entry))

    safe_results = []
    for r, folder_city in raw_pairs:
        if not isinstance(r, dict):
            continue
        safe_results.append(enrich_property({
            "id": r.get("id", "0"),
            "title": r.get("title", "No Title"),
            "city": r.get("city", folder_city),
            "state": r.get("state", state),
            "price": r.get("rent_price", r.get("price", 0)),
            "bedrooms": r.get("bedrooms", 0),
            "bathrooms": r.get("bathrooms", 0),
            "sq_ft": r.get("sq_ft", 0),
            "thumbnail": resolve_image_url(r.get("thumbnail", "")),
            "photos": [resolve_image_url(p) for p in r.get("photos", [])],
            "description": r.get("description", "")
        }))

    filepath = os.path.join(BASE_DIR, "houses", "results.html")
    if not os.path.exists(filepath):
        return "Results template not found", 404
    with open(filepath, "r") as f:
        template = f.read()
    template = inject_navbar(template, active="home")
    return render_template_string(template, houses=safe_results, state=state, city=city)


@app.route('/search/<state>/<city>/<property_id>')
def search_detail(state, city, property_id):
    state = state.title()
    city = city.title()
    details_folder = os.path.join(BASE_DIR, "houses", state, city, "details")

    candidates = [
        os.path.join(details_folder, f"{property_id}.json"),
        os.path.join(details_folder, f"house{property_id}.json"),
    ]
    json_file = next((f for f in candidates if os.path.exists(f)), None)
    if not json_file:
        return f"Property {property_id} not found in {state}/{city}", 404

    house = load_json(json_file)
    house = {
        "id": house.get("id", property_id),
        "title": house.get("title", "No Title"),
        "city": house.get("city", city),
        "state": house.get("state", state),
        "price": house.get("rent_price", house.get("price", 0)),
        "bedrooms": house.get("bedrooms", 0),
        "bathrooms": house.get("bathrooms", 0),
        "sq_ft": house.get("sq_ft", 0),
        "thumbnail": resolve_image_url(house.get("thumbnail", "")),
        "photos": [resolve_image_url(p) for p in house.get("photos", [])],
        "description": house.get("description", "")
    }
    # Use city-specific template if it exists, otherwise fall back to shared template
    city_detail_folder = os.path.join("houses", state, city, "details")
    city_template = os.path.join(BASE_DIR, city_detail_folder, "details.html")
    if os.path.exists(city_template):
        return render_external_template(city_detail_folder, "details.html", house=house, active="home")
    return render_external_template("templates", "details.html", house=house, active="home")


# ---------- Dynamic Section Routes ----------
def make_listing_routes(section, html_file):
    folder = os.path.join(BASE_DIR, section)

    @app.route(f'/{section}', endpoint=f'{section}_list')
    def list_view(section=section, folder=folder, html_file=html_file):
        data = load_all_json_from_folder(folder)
        safe_data = []
        for r in data:
            if not isinstance(r, dict):
                continue
            safe_data.append(enrich_property({
                "id": r.get("id", "0"),
                "title": r.get("title", "No Title"),
                "city": r.get("city", ""),
                "state": r.get("state", ""),
                "price": r.get("rent_price", r.get("price", 0)),
                "bedrooms": r.get("bedrooms", 0),
                "bathrooms": r.get("bathrooms", 0),
                "sq_ft": r.get("sq_ft", 0),
                "thumbnail": resolve_image_url(r.get("thumbnail", "")),
                "photos": [resolve_image_url(p) for p in r.get("photos", [])],
                "description": r.get("description", "")
            }))
        return render_external_template(section, html_file, data=safe_data, active=section)

    @app.route(f'/{section}/<property_id>', endpoint=f'{section}_detail')
    def detail_view(property_id, section=section, folder=folder):
        details_folder = os.path.join(folder, "details")
        candidates = [
            os.path.join(details_folder, f"{property_id}.json"),
            os.path.join(details_folder, f"house{property_id}.json"),
        ]
        json_file = next((f for f in candidates if os.path.exists(f)), None)
        if not json_file:
            return f"Property {property_id} not found in {section}", 404
        house = load_json(json_file)
        house = {
            "id": house.get("id", property_id),
            "title": house.get("title", "No Title"),
            "city": house.get("city", ""),
            "state": house.get("state", ""),
            "price": house.get("rent_price", house.get("price", 0)),
            "bedrooms": house.get("bedrooms", 0),
            "bathrooms": house.get("bathrooms", 0),
            "sq_ft": house.get("sq_ft", 0),
            "thumbnail": resolve_image_url(house.get("thumbnail", "")),
            "photos": [resolve_image_url(p) for p in house.get("photos", [])],
            "description": house.get("description", "")
        }
        return render_external_template(f"{section}/details", "details.html", house=house, active=section)


# Generate routes
make_listing_routes("sale", "saleresults.html")
make_listing_routes("rent", "rentresults.html")
make_listing_routes("contact", "contact.html")


# ---------- All Properties (loads from every state/city in houses/) ----------
@app.route('/properties')
def properties_list():
    houses_dir = os.path.join(BASE_DIR, "houses")
    safe_data = []
    if os.path.exists(houses_dir):
        for state_entry in sorted(os.listdir(houses_dir)):
            state_path = os.path.join(houses_dir, state_entry)
            if not os.path.isdir(state_path) or state_entry.startswith('.'):
                continue
            for city_entry in sorted(os.listdir(state_path)):
                city_path = os.path.join(state_path, city_entry)
                if not os.path.isdir(city_path) or city_entry.startswith('.') or city_entry.lower() == 'details':
                    continue
                for r in load_all_json_from_folder(city_path, ignore_details=True):
                    if not isinstance(r, dict):
                        continue
                    safe_data.append(enrich_property({
                        "id": r.get("id", "0"),
                        "city": r.get("city", city_entry),
                        "state": r.get("state", state_entry),
                        "price": r.get("rent_price", r.get("price", 0)),
                        "bedrooms": r.get("bedrooms", 0),
                        "bathrooms": r.get("bathrooms", 0),
                        "sq_ft": r.get("sq_ft", 0),
                        "thumbnail": resolve_image_url(r.get("thumbnail", "")),
                        "photos": [resolve_image_url(p) for p in r.get("photos", [])],
                        "description": r.get("description", "")
                    }))
    return render_external_template("properties", "properties.html", data=safe_data, active="properties")


@app.route('/properties/<property_id>')
def properties_detail(property_id):
    """Fall back to searching all houses folders by ID."""
    houses_dir = os.path.join(BASE_DIR, "houses")
    for state_entry in sorted(os.listdir(houses_dir)):
        state_path = os.path.join(houses_dir, state_entry)
        if not os.path.isdir(state_path) or state_entry.startswith('.'):
            continue
        for city_entry in sorted(os.listdir(state_path)):
            city_path = os.path.join(state_path, city_entry)
            if not os.path.isdir(city_path) or city_entry.startswith('.'):
                continue
            details_folder = os.path.join(city_path, "details")
            candidates = [
                os.path.join(details_folder, f"{property_id}.json"),
                os.path.join(details_folder, f"house{property_id}.json"),
            ]
            json_file = next((f for f in candidates if os.path.exists(f)), None)
            if json_file:
                house = load_json(json_file)
                house = {
                    "id": house.get("id", property_id),
                    "city": house.get("city", city_entry),
                    "state": house.get("state", state_entry),
                    "price": house.get("rent_price", house.get("price", 0)),
                    "bedrooms": house.get("bedrooms", 0),
                    "bathrooms": house.get("bathrooms", 0),
                    "sq_ft": house.get("sq_ft", 0),
                    "thumbnail": resolve_image_url(house.get("thumbnail", "")),
                    "photos": [resolve_image_url(p) for p in house.get("photos", [])],
                    "description": house.get("description", "")
                }
                city_template = os.path.join(BASE_DIR, "houses", state_entry, city_entry, "details", "details.html")
                if os.path.exists(city_template):
                    return render_external_template(
                        os.path.join("houses", state_entry, city_entry, "details"),
                        "details.html", house=house, active="properties")
                return render_external_template("templates", "details.html", house=house, active="properties")
    return f"Property {property_id} not found", 404


# ---------- Background thread ----------
@app.route('/qr')
def qr_page():
    # Detect local IP so the QR code works on any network
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
    except Exception:
        local_ip = "127.0.0.1"

    url = f"http://{local_ip}:5000"

    img = qrcode.make(url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    qr_b64 = __import__('base64').b64encode(buf.read()).decode()

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Scan to Open on iPhone</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0; padding: 0;
      background: #0f172a;
      min-height: 100vh;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      text-align: center; padding: 40px 20px;
    }}
    h1 {{ color: #f8fafc; font-size: 22px; font-weight: 700; margin: 0 0 8px; }}
    p {{ color: #64748b; font-size: 14px; margin: 0 0 32px; }}
    .qr-wrap {{
      background: #ffffff;
      border-radius: 20px;
      padding: 24px;
      display: inline-block;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }}
    .qr-wrap img {{ display: block; width: 240px; height: 240px; }}
    .url {{
      margin-top: 28px;
      font-size: 15px;
      font-weight: 600;
      color: #f59e0b;
      letter-spacing: 0.3px;
    }}
    .hint {{
      margin-top: 8px;
      font-size: 13px;
      color: #475569;
    }}
  </style>
</head>
<body>
  <h1>Open on iPhone</h1>
  <p>Point your iPhone camera at the QR code below</p>
  <div class="qr-wrap">
    <img src="data:image/png;base64,{qr_b64}" alt="QR code">
  </div>
  <div class="url">{url}</div>
  <div class="hint">Both devices must be on the same Wi-Fi network</div>
</body>
</html>"""
    return html


@app.route('/sw.js')
def service_worker():
    return send_from_directory(os.path.join(BASE_DIR, 'static'), 'sw.js',
                               mimetype='application/javascript')


def run_app():
    app.run(host='0.0.0.0', debug=False, use_reloader=False, port=5000)

thread = Thread(target=run_app)
thread.start()
