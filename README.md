# Paper trader

David Reece's personal paper-trading page. Fake money only. It does not connect to an exchange, keep API keys, or send real orders.

The site is one static page. Each time it opens, it downloads public prices and rebuilds the trades from the launch time to the latest finished candle. Nothing is saved on the phone, so every device that reaches the same price source shows the same result.

Live page (GitHub Pages, from `main`):

https://shadowy-moses.github.io/Paper-trader/

## Day trades

Three signals each start with their own $100. They all use 15-minute candles for Bitcoin, Ethereum, and Solana, and they can be compared with each other. A buy is sized so the stop loses at most 2% of that strategy's balance, after the fee and the price cushion. After 3 losing sells in one Chicago day, that strategy stops buying until the next day. Anything still open is sold at midnight Central time. The log reason is exactly `end of day.`

Earlier candles are used only so the averages exist at midnight. Nothing is bought before the start.

1. **Momentum breakout.** Buy when a candle closes above the high of the previous 20 candles and its volume is at least 1.5 times the 20-candle average. Stop at the buy minus 1.5 times the 14-candle average swing (ATR). Take profit at the buy plus 3 times that swing.
2. **Trend pullback.** Only while the 20-bar average is above the 50-bar average. Buy when price touches or dips to the 20-bar average and RSI crosses back above 40. Same stop and take profit as the breakout.
3. **Oversold bounce.** Buy when RSI falls below 25 and the next candle closes higher. Take profit at the 20-bar average. Stop is 1% under the buy.

The page shows each strategy's balance, gain or loss, trade count, and fees, plus a line for each coin so you can see which coin suits which signal.

## Slower comparison

Below the day trades, the original strategy still runs on its own $100 and hourly prices. The $100 is split across Bitcoin, Ethereum, and Solana. It buys a coin when the 24-hour average crosses above the 72-hour average, and sells when it crosses back under. It also sells if the price drops 4% from the buy. It does not chase a crossover that already happened, it does not borrow, and it does not bet on a coin falling.

The same $100 is also shown as if it had simply bought Bitcoin at the first finished 15-minute price and held it, with the same fee and cushion. That hold is marked on the latest 15-minute close. The slower strategy is marked on the latest hourly close, so the two can differ by up to an hour.

| Setting | Value | Why |
| --- | --- | --- |
| Start | Oct 16, 2026, midnight Central time | Launch day. One value, `START_TIME`. |
| Day-trade cash | $100 each | Three separate piles, not one combined account. |
| Slower cash | $100 | Split across the coins, to the cent. |
| Coins | Bitcoin, Ethereum, Solana | Add another object to the `coins` list. Keep `id: "BTC"`. |
| Day candles | 15 minutes | The three signals. |
| Hourly averages | 24 hours and 72 hours | The slower comparison. |
| Fee | 0.1% | Charged on every buy and every sell. |
| Price cushion | 0.05% | Buys fill a little higher, sells a little lower. |
| Day risk | 2% of that strategy's balance | Planned loss if the stop fills. A gap through the stop can lose more. |
| Daily stop | 3 losses | No new buys for the rest of that Chicago day. |

Times on the page are Central time (America/Chicago).

Day signals live in [`js/day-strategies.js`](js/day-strategies.js). The slower strategy lives in [`js/strategy.js`](js/strategy.js). Settings live in [`js/config.js`](js/config.js).

## Prices

Candles come from Binance's public market-data host (`data-api.binance.vision`), which allows a phone browser to call it with no key. If that fails, the page uses Coinbase's public candles for every coin and both candle sizes. One source per visit, so the coins are not mixed.

Only finished candles are used. The current, still-open candle is ignored, which is why two phones opened in the same 15 minutes agree.

## Run it locally

```bash
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173/`. File URLs will not load the modules.

```bash
npm test
```

## GitHub Pages

`.github/workflows/pages.yml` deploys the page on every push to `main`. Pages is already set to deploy from GitHub Actions. No other host and no paid service.
