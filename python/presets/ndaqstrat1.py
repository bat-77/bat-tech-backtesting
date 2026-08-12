"""
ndaqstrat1.py — NDAQ Mean Reversion (Z-Score) with SL/TP
==========================================================
Entry: monthly-return z-score vs its own rolling 4-month distribution.
Exit:  hard SL/TP set at entry (checked by the engine every bar),
       OR explicit CLOSE when z-score reverts to neutral,
       OR flip on opposite extreme.

SL/TP sizing: uses recent average absolute monthly return range as a
volatility proxy so stops scale with how choppy NDAQ has been recently.
"""

import pandas as pd


class Expert:
    def init(self, data):
        rets = data['Close'].pct_change()
        rolling_mean = rets.rolling(window=4).mean()
        rolling_std = rets.rolling(window=4).std()
        self.zscore = (rets - rolling_mean) / rolling_std

        # Volatility proxy for SL/TP distance: avg monthly High-Low range
        self.avg_range = (data['High'] - data['Low']).rolling(window=4).mean()

        self.timestamps = data.index

    def next(self, bar, position, equity):
        current_time = bar.name
        i = self.timestamps.get_loc(current_time)

        if i < 4:
            return None

        z = self.zscore.iloc[i]
        avg_range = self.avg_range.iloc[i]

        if pd.isna(z) or pd.isna(avg_range):
            return None

        close = bar['Close']
        sl_distance = avg_range * 1.5   # stop = 1.5x avg monthly range
        tp_distance = avg_range * 2.0   # target = 2x avg monthly range

        # Oversold -> expect reversion up
        if z < -1.0:
            if position is None or position['direction'] == 'short':
                return {
                    "action": "BUY",
                    "sl": close - sl_distance,
                    "tp": close + tp_distance,
                }

        # Overbought -> expect reversion down
        elif z > 1.0:
            if position is None or position['direction'] == 'long':
                return {
                    "action": "SELL",
                    "sl": close + sl_distance,
                    "tp": close - tp_distance,
                }

        # Neutral zone -> flatten early if we're still in a position
        elif -0.25 <= z <= 0.25:
            if position is not None:
                return {"action": "CLOSE"}

        return None
