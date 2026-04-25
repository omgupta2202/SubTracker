-- ============================================================
-- Merchant → category mapping for auto-categorization.
--
-- Two layers:
--   1. user-specific overrides (user_id NOT NULL)  — highest priority
--   2. global rules           (user_id IS NULL)    — fallback for everyone
--
-- pattern is a case-insensitive substring match against
-- (merchant, description). First match wins; longest pattern first.
-- ============================================================

CREATE TABLE IF NOT EXISTS merchant_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  pattern     TEXT NOT NULL,
  category    TEXT NOT NULL,
  priority    INT  NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mc_pattern_not_empty CHECK (length(trim(pattern)) > 0)
);

CREATE INDEX IF NOT EXISTS mc_user_idx       ON merchant_categories (user_id);
CREATE INDEX IF NOT EXISTS mc_pattern_lc_idx ON merchant_categories (lower(pattern));

-- ============================================================
-- Seed rules — common Indian merchants. Idempotent via WHERE NOT EXISTS.
-- ============================================================

INSERT INTO merchant_categories (user_id, pattern, category, priority)
SELECT NULL, p, c, pr FROM (VALUES
  -- Food & dining
  ('zomato',        'Food',          10),
  ('swiggy',        'Food',          10),
  ('blinkit',       'Groceries',      9),
  ('zepto',         'Groceries',      9),
  ('bigbasket',     'Groceries',      9),
  ('instamart',     'Groceries',      9),
  ('dunzo',         'Groceries',      8),
  -- Travel & rides
  ('uber',          'Travel',        10),
  ('ola',           'Travel',        10),
  ('rapido',        'Travel',         9),
  ('irctc',         'Travel',        10),
  ('makemytrip',    'Travel',        10),
  ('goibibo',       'Travel',        10),
  ('cleartrip',     'Travel',         9),
  ('indigo',        'Travel',        10),
  ('vistara',       'Travel',        10),
  ('air india',     'Travel',         9),
  -- Streaming & subscriptions
  ('netflix',       'Subscriptions', 10),
  ('spotify',       'Subscriptions', 10),
  ('prime video',   'Subscriptions',  9),
  ('hotstar',       'Subscriptions', 10),
  ('disney',        'Subscriptions',  9),
  ('youtube',       'Subscriptions',  9),
  ('apple.com',     'Subscriptions',  8),
  ('icloud',        'Subscriptions',  8),
  ('claude',        'Dev Tools',     10),
  ('openai',        'Dev Tools',     10),
  ('anthropic',     'Dev Tools',     10),
  ('github',        'Dev Tools',     10),
  ('vercel',        'Dev Tools',      9),
  ('netlify',       'Dev Tools',      9),
  ('digitalocean',  'Dev Tools',      9),
  ('aws',           'Dev Tools',      9),
  ('amazon web',    'Dev Tools',     10),
  -- Shopping
  ('amazon',        'Shopping',       8),
  ('flipkart',      'Shopping',       9),
  ('myntra',        'Shopping',       9),
  ('ajio',          'Shopping',       9),
  ('nykaa',         'Shopping',       9),
  ('meesho',        'Shopping',       8),
  -- Bills & utilities
  ('airtel',        'Utilities',      9),
  ('jio',           'Utilities',      9),
  ('vi ',           'Utilities',      8),
  ('vodafone',      'Utilities',      9),
  ('tata power',    'Utilities',      9),
  ('bescom',        'Utilities',      9),
  ('msedcl',        'Utilities',      9),
  ('act fibernet',  'Utilities',      9),
  ('jio fiber',     'Utilities',      9),
  -- Health & fitness
  ('1mg',           'Health',         9),
  ('pharmeasy',     'Health',         9),
  ('apollo',        'Health',         9),
  ('cult.fit',      'Health',         9),
  ('cure.fit',      'Health',         9),
  -- Finance / fees / interest (dont auto-tag as expense)
  ('refund',        'Refund',        10),
  ('cashback',      'Refund',         9)
) AS seed(p, c, pr)
WHERE NOT EXISTS (
  SELECT 1 FROM merchant_categories
  WHERE user_id IS NULL AND lower(pattern) = lower(seed.p)
);
