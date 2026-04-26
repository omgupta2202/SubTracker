"""
SubTracker module — the personal-finance dashboard half of the app.

Owns:
  - financial_accounts, ledger, payments, obligations, billing_cycles,
    smart_allocation, dashboard summary, daily_logs, reminders + actions,
    public unsubscribe, plus the legacy subscriptions/emis/cards/accounts/
    receivables/capex/rent/snapshots/card-transactions endpoints.

Self-contained: every route imports from `modules.subtracker.services.*`,
shared infra only (`db`, `utils`, `modules.auth.email`). Designed to lift
into its own microservice the same way `expense_tracker` is — copy the
folder, register the blueprints on a fresh Flask, point at the same DB.

Public surface for the host to wire:
    BLUEPRINTS         — list of every Flask blueprint this module owns
    services           — namespace import for in-process callers
"""
from modules.subtracker.routes.subscriptions      import bp as _subscriptions_bp
from modules.subtracker.routes.emis               import bp as _emis_bp
from modules.subtracker.routes.cards              import bp as _cards_bp
from modules.subtracker.routes.accounts           import bp as _accounts_bp
from modules.subtracker.routes.receivables        import bp as _receivables_bp
from modules.subtracker.routes.capex              import bp as _capex_bp
from modules.subtracker.routes.rent               import bp as _rent_bp
from modules.subtracker.routes.snapshots          import bp as _snapshots_bp
from modules.subtracker.routes.card_transactions  import bp as _card_transactions_bp
from modules.subtracker.routes.financial_accounts import bp as _financial_accounts_bp
from modules.subtracker.routes.ledger_routes      import bp as _ledger_bp
from modules.subtracker.routes.payments           import bp as _payments_bp
from modules.subtracker.routes.obligations        import bp as _obligations_bp
from modules.subtracker.routes.billing_cycles     import bp as _billing_cycles_bp
from modules.subtracker.routes.allocation         import bp as _allocation_bp
from modules.subtracker.routes.daily_logs         import bp as _daily_logs_bp
from modules.subtracker.routes.dashboard          import bp as _dashboard_bp
from modules.subtracker.routes.reminders          import bp as _reminders_bp
from modules.subtracker.routes.reminder_actions   import bp as _reminder_actions_bp
from modules.subtracker.routes.unsubscribe        import bp as _unsubscribe_bp
from modules.subtracker import services  # noqa: F401

BLUEPRINTS = [
    _subscriptions_bp, _emis_bp, _cards_bp, _accounts_bp, _receivables_bp,
    _capex_bp, _rent_bp, _snapshots_bp, _card_transactions_bp,
    _financial_accounts_bp, _ledger_bp, _payments_bp, _obligations_bp,
    _billing_cycles_bp, _allocation_bp, _daily_logs_bp, _dashboard_bp,
    _reminders_bp, _reminder_actions_bp, _unsubscribe_bp,
]
