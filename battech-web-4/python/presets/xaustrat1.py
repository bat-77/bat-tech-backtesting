"""
xaustrat1.py — XAU Volatility Breakout with SL/TP
====================================================
Entry: close breaks above/below prior month's High/Low WITH range
       expansion (current range > recent average range).
Exit:  SL placed just inside the broken level (invalidation point),
       TP set at 2x the risk distance (2R). OR flip on opposite breakout.
"""

import pandas as pd


class Expert:
    def init(self, data):
        self.high = data['High']
        self.low = data['Low']
        self.close = data['Close']
        self.range_ = self.high - self.low
        self.avg_range = self.range_.rolling(window=3).mean()
        self.timestamps = data.index

    def next(self, bar, position, equity):
        current_time = bar.name
        i = self.timestamps.get_loc(current_time)

        if i < 4:
            return None

        prev_high = self.high.iloc[i - 1]
        prev_low = self.low.iloc[i - 1]
        prev_avg_range = self.avg_range.iloc[i - 1]

        if pd.isna(prev_avg_range):
            return None

        current_close = bar['Close']
        current_range = self.range_.iloc[i]

        # Breakout above prior high with range expansion
        if current_close > prev_high and current_range > prev_avg_range:
            if position is None or position['direction'] == 'short':
                risk = current_close - prev_high  # distance back to breakout level
                risk = max(risk, prev_avg_range * 0.5)  # floor so SL isn't absurdly tight
                return {
                    "action": "BUY",
                    "sl": prev_high - risk * 0.25,   # just under the breakout level
                    "tp": current_close + risk * 2,   # 2R target
                }

        # Breakdown below prior low with range expansion
        elif current_close < prev_low and current_range > prev_avg_range:
            if position is None or position['direction'] == 'long':
                risk = prev_low - current_close
                risk = max(risk, prev_avg_range * 0.5)
                return {
                    "action": "SELL",
                    "sl": prev_low + risk * 0.25,
                    "tp": current_close - risk * 2,
                }

        return None
