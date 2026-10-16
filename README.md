# Paper trader

David Reece's personal paper-trading page. Fake money only. It does not connect to an exchange, keep API keys, or send real orders.

The site is one static page. Each time it opens, it downloads public hourly prices and rebuilds the trades from the launch time to the latest finished hour. Nothing is saved on the phone, so every device that reaches the same price source shows the same result.

Live page (after this is merged to `main` and GitHub Pages is set to deploy from Actions):

https://shadowy-moses.github.io/paper-trader/

## How it decides

The $100 is split across Bitcoin, Ethereum, and Solana. It buys a coin when the 24-hour average crosses above the 72-hour average, and sells when it crosses back under. It also sells if the price drops 4% from the buy. Each trade costs a 0.1% fee, plus a 0.05% price cushion so the fill is a little worse than the posted price.

It only buys after the start, and only when the average actually crosses. It does not chase a crossover that already happened, it does not borrow, and it does not bet on a coin falling.

The same $100 is also shown as if it had simply bought Bitcoin at the start and held it, with the same fee and cushion, so there is a plain comparison.

The strategy lives in [`js/strategy.js`](js/strategy.js). Settings live in [`js/config.js`](js/config.js).

| Setting | Value | Why |
| --- | --- | --- |
| Start | Oct 16, 2026, midnight Central time | Launch day. One value, `START_TIME`. |
| Starting cash | $100 | Split across the coins, to the cent. |
| Coins | Bitcoin, Ethereum, Solana | Add another object to the `coins` list. |
| Averages | 24 hours and 72 hours | A one-day trend against a three-day trend. |
| Safety line | 4% under the buy | Wide enough for an hourly swing, tight enough to cap a bad entry. |
| Fee | 0.1% | Charged on every buy and every sell. |
| Price cushion | 0.05% | Buys fill a little higher, sells a little lower. |

Times on the page are Central time (America/Chicago).

## Prices

Hourly candles come from Binance's public market-data host (`data-api.binance.vision`), which allows a phone browser to call it with no key. If that fails, the page uses Coinbase's public hourly candles for every coin. One source per visit, so the coins are not mixed.

Only finished hours are used. The current, still-open hour is ignored, which is why two phones opened in the same hour agree.

## Run it locally

```bash
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173/`. File URLs will not load the modules.

```bash
npm test
```

## GitHub Pages

`.github/workflows/pages.yml` deploys the page on every push to `main`. In the repo settings, set Pages → Build and deployment → Source to **GitHub Actions** once. No other host and no paid service.
