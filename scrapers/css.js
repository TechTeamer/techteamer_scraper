const config = require('../config')
const Scraper = require('../src/Scraper')
const typeIs = require('type-is')

class CssScraper extends Scraper {
  constructor (options = {}) {
    // super(Object.assign(config.clone('scrapers.nfc-demo'), options || {}))
    super(Object.assign(config.clone('scrapers.css'), options || {}))
  }

  shouldCheckOcsp (requestUrl, proxyReq, req, res) {
    const accepts = req.headers.accept.split(/,/)
    const isDocument = accepts.some(mediaType => typeIs.is(mediaType, ['text/html']))
    const isAllowedPath = ['/'].includes(requestUrl.pathname)
    return isDocument && isAllowedPath
  }

  async scraper (puppet, browser) {
    const page = await puppet.setupPage(browser, 'http://localhost:8080/')

    console.log('Page opened')

    // await puppet.submitForm(page, {
    //   form: '#registration-form',
    //   submit: 'button[type="submit"]',
    //   fields: {
    //     '#input-lastName': 'Asd',
    //     '#input-firstName': 'Asd',
    //     '#input-email': 'zoltan.nagy@techteamer.com',
    //     '#input-phoneNumber': '+36305585530',
    //     '#input-idCardNumber': '123123AB',
    //     '#input-idType': ['id-card'],
    //     '#input-addressCardNumber': '123123AB',
    //     '#input-location': ['hu']
    //   }
    // })
  }
}

module.exports = CssScraper
