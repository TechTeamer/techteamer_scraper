Scraper
=======

Scrape websites with Puppeteer and save communication data about requests and responses.
Uses an internal proxy to access requests/responses from a target host.

## Capabilities

- Save website contents
- Save certificates during TLS
- Check OCSP responses for TLS certificates
- Interactively navigate on pages using Puppeteer
- Target host IP filter

## Usage

Extend the Scraper class

```js
const Scraper = require('@techteamer/scraper')

class MyCustomScraper extends Scraper {
  constructor (options = {}) {
    super(options)
  }

  shouldCheckOcsp (requestUrl, proxyReq, req, res) {
    // decide whether or not check OCSP for a specific request.
    return true
  }

  async scraper (puppet, browser) {
    // user puppeteer to interact with the page
    const page = await puppet.setupPage(browser, '/')
  }
}
```

```js
const scraper = new MyCustomScraper({}) // provide scraper config options

scraper.scrape().then(() => {
  console.log('Finished scraping')
  process.exit()
}).catch((err) => {
  console.error('Failed scraping', err)
  process.exit(1)
})
```

## Config

```json
{
  "port": 8080,
  "ipFilter": "142.251.36.78",
  "proxy":  {
    "minVersion": "TLSv1.2",
    "ca": null,
    "target": {
      "protocol": "https:",
      "host": "example.com",
      "port": 443
    }
  },
  "ocsp": {
    "agent": {}
  },
  "browser":  {
    "autoClose": false,
    "puppeteer": {
      "headless": true
    }
  },
  "save": {
    "rootDir": "captures/"
  },
  "loggerOptions": {
    "verbosity": {
      "headers": false
    }
  }
}
```
