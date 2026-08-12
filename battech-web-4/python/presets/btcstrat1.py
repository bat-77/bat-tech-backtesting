"""
btcstrat1.py — BTC Trend Following (Dual SMA Crossover) with SL/TP
=====================================================================
Entry: 3-month SMA crosses 6-month SMA.
Exit:  SL at a volatility-scaled distance from entry (protects against
       BTC's large adverse swings at 100x leverage), TP at 3x that
       distance to let winners run with trend-following. Also flips
       on opposite crossover.
"""

import pandas as pd


class Expert:
    def init(self, data):
        self.fast = data['Close'].rolling(window=3).mean()
        self.slow = data['Close'].rolling(window=6).mean()
        self.avg_range = (data['High'] - data['Low']).rolling(window=6).mean()
        self.timestamps = data.index

    def next(self, bar, position, equity):
        current_time = bar.name
        i = self.timestamps.get_loc(current_time)

        if i < 6:
            return None

        fast_now = self.fast.iloc[i]
        slow_now = self.slow.iloc[i]
        fast_prev = self.fast.iloc[i - 1]
        slow_prev = self.slow.iloc[i - 1]
        avg_range = self.avg_range.iloc[i]

        if pd.isna(avg_range):
            return None

        crossed_up = fast_prev <= slow_prev and fast_now > slow_now
        crossed_down = fast_prev >= slow_prev and fast_now < slow_now

        close = bar['Close']
        sl_distance = avg_range * 1.0   # 1x avg monthly range — BTC is volatile, keep it tight-ish
        tp_distance = avg_range * 3.0   # let trend winners run to 3x

        if crossed_up:
            if position is None or position['direction'] == 'short':
                return {
                    "action": "BUY",
                    "sl": close - sl_distance,
                    "tp": close + tp_distance,
                }
        elif crossed_down:
            if position is None or position['direction'] == 'long':
                return {
                    "action": "SELL",
                    "sl": close + sl_distance,
                    "tp": close - tp_distance,
                }

        return None
