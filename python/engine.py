"""
BAT-TECH Backtest Engine — Phase 2 (Browser / Pyodide)
========================================================
This is the SAME math/logic as the Phase 1 local engine, ported to run
inside Pyodide. JavaScript hands it raw OHLCV records (fetched client-side,
since yfinance itself cannot run in a browser) and the user's Expert code
as a string. All numerical work — engine loop, SL/TP, metrics — happens here
in Python, not JS.
"""

import json
import numpy as np
import pandas as pd

INITIAL_CAPITAL = 100_000.0
LEVERAGE = 100
COMMISSION_PCT = 0.001
DELAY_BARS = 0


def build_dataframe(records_json):
    """records_json: JSON string of [{date, open, high, low, close, volume}, ...]"""
    records = json.loads(records_json)
    df = pd.DataFrame(records)
    df['date'] = pd.to_datetime(df['date'])
    df = df.set_index('date')
    df = df.rename(columns={
        'open': 'Open', 'high': 'High', 'low': 'Low',
        'close': 'Close', 'volume': 'Volume'
    })
    df = df[['Open', 'High', 'Low', 'Close', 'Volume']].dropna()
    df = df.sort_index()
    return df


def normalize_signal(signal):
    if signal is None:
        return None, None, None
    if isinstance(signal, str):
        return signal, None, None
    if isinstance(signal, dict):
        return signal.get("action"), signal.get("sl"), signal.get("tp")
    raise ValueError(f"next() returned unsupported type: {type(signal)}")


def run_backtest(df, expert):
    expert.init(df.copy())

    equity = INITIAL_CAPITAL
    position = None
    equity_curve = []
    drawdown_curve = []
    trades = []
    peak_equity = INITIAL_CAPITAL

    def commission_cost(notional):
        return notional * COMMISSION_PCT

    def open_position(direction, entry_price, entry_time, sl, tp):
        size = (equity * LEVERAGE) / entry_price
        notional = size * entry_price
        cost = commission_cost(notional)
        return {
            "direction": direction, "entry_price": entry_price, "size": size,
            "entry_time": entry_time, "sl": sl, "tp": tp,
        }, cost

    def close_position(pos, exit_price, exit_time, reason=""):
        nonlocal equity
        direction = pos["direction"]
        size = pos["size"]
        entry_price = pos["entry_price"]

        if direction == "long":
            gross_pnl = (exit_price - entry_price) * size
        else:
            gross_pnl = (entry_price - exit_price) * size

        exit_commission = commission_cost(size * exit_price)
        net_pnl = gross_pnl - exit_commission
        equity += gross_pnl - exit_commission

        trades.append({
            "entry_time": str(pos["entry_time"]), "exit_time": str(exit_time),
            "entry_price": entry_price, "exit_price": exit_price,
            "direction": direction, "size": size,
            "gross_pnl": gross_pnl, "net_pnl": net_pnl, "exit_reason": reason,
        })
        return net_pnl

    for i in range(len(df)):
        bar = df.iloc[i]
        bar_time = df.index[i]
        bar_high, bar_low, bar_close = bar["High"], bar["Low"], bar["Close"]

        if position is not None:
            sl, tp, direction = position["sl"], position["tp"], position["direction"]
            exit_price, reason = None, None
            if direction == "long":
                hit_sl = sl is not None and bar_low <= sl
                hit_tp = tp is not None and bar_high >= tp
                if hit_sl:
                    exit_price, reason = sl, "SL"
                elif hit_tp:
                    exit_price, reason = tp, "TP"
            else:
                hit_sl = sl is not None and bar_high >= sl
                hit_tp = tp is not None and bar_low <= tp
                if hit_sl:
                    exit_price, reason = sl, "SL"
                elif hit_tp:
                    exit_price, reason = tp, "TP"
            if exit_price is not None:
                close_position(position, exit_price, bar_time, reason=reason)
                position = None

        signal = expert.next(bar, position, equity)
        action, sl, tp = normalize_signal(signal)

        if action == "BUY":
            if position is not None and position["direction"] == "short":
                close_position(position, bar_close, bar_time, reason="FLIP")
                position = None
            if position is None:
                position, entry_cost = open_position("long", bar_close, bar_time, sl, tp)
                equity -= entry_cost
        elif action == "SELL":
            if position is not None and position["direction"] == "long":
                close_position(position, bar_close, bar_time, reason="FLIP")
                position = None
            if position is None:
                position, entry_cost = open_position("short", bar_close, bar_time, sl, tp)
                equity -= entry_cost
        elif action == "CLOSE":
            if position is not None:
                close_position(position, bar_close, bar_time, reason="SIGNAL")
                position = None

        if position is not None:
            size, entry_price, direction = position["size"], position["entry_price"], position["direction"]
            unrealized = (bar_close - entry_price) * size if direction == "long" else (entry_price - bar_close) * size
            mtm_equity = equity + unrealized
        else:
            mtm_equity = equity

        peak_equity = max(peak_equity, mtm_equity)
        drawdown_curve.append(peak_equity - mtm_equity)
        equity_curve.append(mtm_equity)

    if position is not None:
        last_time = df.index[-1]
        last_close = df.iloc[-1]["Close"]
        close_position(position, last_close, last_time, reason="EOD_FORCE_CLOSE")
        equity_curve[-1] = equity
        drawdown_curve[-1] = max(peak_equity, equity) - equity

    for t in trades:
        entry_idx = df.index.get_loc(pd.to_datetime(t["entry_time"]))
        exit_idx = df.index.get_loc(pd.to_datetime(t["exit_time"]))
        t["bars_held"] = int(exit_idx - entry_idx)

    return {
        "equity_curve": [float(x) for x in equity_curve],
        "drawdown_curve": [float(x) for x in drawdown_curve],
        "dates": [str(d.date()) for d in df.index],
        "trades": trades,
        "final_equity": float(equity),
        "close_prices": [float(x) for x in df["Close"].tolist()],
    }


def compute_metrics(results):
    trades = results["trades"]
    equity_curve = pd.Series(results["equity_curve"])
    drawdown_curve = pd.Series(results["drawdown_curve"])
    final_equity = results["final_equity"]

    total_trades = len(trades)
    wins = [t for t in trades if t["net_pnl"] > 0]
    losses = [t for t in trades if t["net_pnl"] <= 0]

    gross_profit = sum(t["gross_pnl"] for t in wins) if wins else 0.0
    gross_loss = sum(t["gross_pnl"] for t in losses) if losses else 0.0
    total_commission = sum((t["gross_pnl"] - t["net_pnl"]) for t in trades) if trades else 0.0

    net_profit = final_equity - INITIAL_CAPITAL
    win_rate = (len(wins) / total_trades * 100) if total_trades else 0.0
    profit_factor = abs(gross_profit / gross_loss) if gross_loss != 0 else float("inf")
    expected_payoff = (net_profit / total_trades) if total_trades else 0.0
    total_return_pct = (net_profit / INITIAL_CAPITAL) * 100

    max_dd = float(drawdown_curve.max()) if len(drawdown_curve) else 0.0
    peak_series = (drawdown_curve + equity_curve)
    max_dd_pct = (max_dd / peak_series.max() * 100) if len(peak_series) and peak_series.max() else 0.0

    rets = equity_curve.pct_change().dropna()
    sharpe = float(rets.mean() / rets.std() * np.sqrt(12)) if len(rets) and rets.std() != 0 else 0.0

    largest_profit = max((t["net_pnl"] for t in wins), default=0.0)
    largest_loss = min((t["net_pnl"] for t in losses), default=0.0)
    avg_profit = float(np.mean([t["net_pnl"] for t in wins])) if wins else 0.0
    avg_loss = float(np.mean([t["net_pnl"] for t in losses])) if losses else 0.0
    avg_bars_held = float(np.mean([t["bars_held"] for t in trades])) if trades else 0.0

    max_c_wins = max_c_losses = c_wins = c_losses = 0
    for t in trades:
        if t["net_pnl"] > 0:
            c_wins += 1; c_losses = 0
        else:
            c_losses += 1; c_wins = 0
        max_c_wins = max(max_c_wins, c_wins)
        max_c_losses = max(max_c_losses, c_losses)

    return {
        "Original Capital": f"${INITIAL_CAPITAL:,.2f}",
        "Leverage Used": f"{LEVERAGE}x",
        "Total Trades": total_trades,
        "Profit Trades": f"{len(wins)} ({win_rate:.1f}%)",
        "Loss Trades": f"{len(losses)} ({100 - win_rate:.1f}%)" if total_trades else "0 (0.0%)",
        "Win Rate (%)": f"{win_rate:.2f}%",
        "Money Made (Gross Profit)": f"${gross_profit:,.2f}",
        "Money Lost (Gross Loss)": f"${gross_loss:,.2f}",
        "Total Commission Paid": f"${total_commission:,.2f}",
        "Net Profit": f"${net_profit:,.2f}",
        "Profit Factor": f"{profit_factor:.2f}",
        "Expected Payoff": f"${expected_payoff:,.2f}",
        "Total Return %": f"{total_return_pct:.2f}%",
        "Max Drawdown ($)": f"${max_dd:,.2f}",
        "Max Drawdown (%)": f"{max_dd_pct:.2f}%",
        "Sharpe Ratio": f"{sharpe:.2f}",
        "Largest Profit": f"${largest_profit:,.2f}",
        "Largest Loss": f"${largest_loss:,.2f}",
        "Average Profit": f"${avg_profit:,.2f}",
        "Average Loss": f"${avg_loss:,.2f}",
        "Max Consecutive Wins": max_c_wins,
        "Max Consecutive Losses": max_c_losses,
        "Average Bars Held": f"{avg_bars_held:.1f}",
        "Final Equity": f"${final_equity:,.2f}",
    }


def run_full_backtest(records_json, expert_code):
    """Entry point called from JS. Returns a JSON string."""
    df = build_dataframe(records_json)

    namespace = {}
    exec(expert_code, namespace)
    if "Expert" not in namespace:
        raise ValueError("Your code must define a class named 'Expert'.")
    expert = namespace["Expert"]()

    results = run_backtest(df, expert)
    metrics = compute_metrics(results)

    output = {
        "metrics": metrics,
        "trades": results["trades"],
        "equity_curve": results["equity_curve"],
        "drawdown_curve": results["drawdown_curve"],
        "dates": results["dates"],
        "close_prices": results["close_prices"],
    }
    return json.dumps(output)
