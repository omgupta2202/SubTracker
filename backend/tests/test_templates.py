"""
Templates: ensure the catalog stays well-formed. Cheap test that catches
typos like a missing color or an empty category list slipping into a
non-blank template.
"""
from modules.expense_tracker.service import list_templates, TRACKER_TEMPLATES, VALID_COLORS


def test_every_template_has_required_fields():
    for tpl in list_templates():
        assert tpl["slug"]
        assert tpl["label"]
        assert tpl["description"]
        assert "categories" in tpl
        assert isinstance(tpl["categories"], list)


def test_every_category_uses_a_known_color():
    for slug, tpl in TRACKER_TEMPLATES.items():
        for c in tpl["categories"]:
            assert c["name"]
            assert c.get("color", "violet") in VALID_COLORS, \
                f"Bad color in {slug}: {c}"


def test_only_blank_template_has_zero_categories():
    """If we add a non-blank template with an empty list it's almost
    certainly a typo — surface it here."""
    for slug, tpl in TRACKER_TEMPLATES.items():
        if slug == "blank":
            assert tpl["categories"] == []
        else:
            assert len(tpl["categories"]) > 0, f"Template '{slug}' has no categories"


def test_blank_template_exists():
    assert "blank" in TRACKER_TEMPLATES
