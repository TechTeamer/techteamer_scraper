const config = require('../config')
const Scraper = require('../src/Scraper')
const typeIs = require('type-is')

class CssScraper extends Scraper {
  constructor (options = {}) {
    super(Object.assign(config.clone('scrapers.css'), options || {}))
  }

  shouldCheckOcsp (requestUrl, proxyReq, req, res) {
    const accepts = req.headers.accept.split(/,/)
    const isDocument = accepts.some(mediaType => typeIs.is(mediaType, ['text/html']))
    const isAllowedPath = ['/'].includes(requestUrl.pathname)
    return isDocument && isAllowedPath
  }

  async scraper (puppet, browser) {
    const page = await puppet.setupPage(browser)
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.27 Safari/537.36')

    await page.goto('https://www.nyilvantarto.hu/ugyseged/OkmanyErvenyessegLekerdezes.xhtml')
    await page.waitForNetworkIdle()

    const navigationPromise = page.waitForNavigation({
      timeout: 30000
    })
    const submitPromise = await submitForm(page, {
      form: '#okmanyErvenyessegLekerdezesForm',
      submit: '[id="okmanyErvenyessegLekerdezesForm:lekerdezesInditasa"',
      fields: {
        '[id="okmanyErvenyessegLekerdezesForm:okmanyTipus"]': ['SZEMELYI_IGAZOLVANY'],
        '[id="okmanyErvenyessegLekerdezesForm:okmanyAzonosito"]': '178507BE',
        '[id="okmanyErvenyessegLekerdezesForm:anyjaNeve"]': 'Dömölki Piroska Katalin',
        '[id="okmanyErvenyessegLekerdezesForm:csaladiNev"]': 'Nagy',
        '[id="okmanyErvenyessegLekerdezesForm:utoNev"]': 'Zoltán Tamás',
        '[id="okmanyErvenyessegLekerdezesForm:szuletesiHely"]': 'Budapest',
        '[id="okmanyErvenyessegLekerdezesForm:szuletesiIdo_input"]': '1988.09.02',
        '[id="okmanyErvenyessegLekerdezesForm:captcha"]': async () => {
          const { captcha } = await inquirer.prompt([
            { type: 'input', name: 'captcha' }
          ])
          return captcha
        }
      }
    })

    const [response] = await Promise.all([
      navigationPromise,
      page.waitForNetworkIdle(),
      submitPromise
    ])

    /*
      <span id="okmanyErvenyessegLekerdezesForm:okmanyErvenyessegEredmeny">
        <div class="alert alert-success">
            <span id="okmanyErvenyessegLekerdezesForm:uzenet">A személyazonosság igazolására alkalmas hatósági igazolvány a megadott adatokkal érvényes.</span>
        </div>
      </span>
    * */
    await puppet.logResponse(response)

    await page.waitForSelector('[id="okmanyErvenyessegLekerdezesForm:okmanyErvenyessegEredmeny"]')
    const resultBox = await page.$('[id="okmanyErvenyessegLekerdezesForm:okmanyErvenyessegEredmeny"]')
    const isSuccess = await resultBox.$eval('.alert', node => node.classList.contains('alert-success'))
    const resultText = await resultBox.$eval('[id="okmanyErvenyessegLekerdezesForm:uzenet"]', node => node.textContent)

    console.log(isSuccess, resultText)
  }
}

module.exports = CssScraper

async function nyilvantarto (browser) {
}
