const puppeteer = require('puppeteer')

class Puppet {
  /**
   * @param {Object} puppetOptions
   * @param {Boolean} puppetOptions.autoClose auto close browser window after the scraper function finishes
   * @param {Object} puppetOptions.puppeteer Puppeteer options
   */
  constructor (puppetOptions) {
    this.options = puppetOptions
    this.logger = this.options.logger || global.console
    this.browser = null
  }

  /**
   * @param {function(Puppet, Browser)} handler
   * @param [options]
   * @param [options.autoClose=true]
   * @returns {Promise<*>}
   */
  async browse (handler, options) {
    try {
      this.browser = await this.setupBrowser(this.options.puppeteer)
    } catch (err) {
      this.logger.error('Error setting up browser', err)
      throw new Error('Error setting up browser')
    }

    let results
    try {
      results = await handler(this, this.browser)
    } catch (err) {
      if (!this.browser) {
        // handle force close events form the outside during a connection attempt
        // NOTE: sometimes it's okay to receive an error here if the browser was abruptly closed
        // e.g. if TLS was rejected it causes "Protocol error (Page.navigate): Target closed."
        this.logger.warn('Browser already closed:', err.message)
        return
      }

      this.logger.error('Error doing scraping stuff', err)
      throw new Error('Error doing scraping stuff')
    }

    if (this.options.autoClose) {
      await this.browser.close()
      this.browser = null
    }

    return results
  }

  async close () {
    if (this.browser) {
      const browser = this.browser
      this.browser = null
      await browser.close()
    }
  }

  async setupBrowser (options = {}) {
    return puppeteer.launch({
      headless: true,
      ...(options || {})
    })
  }

  async logResponse (response) {
    const request = response.request()
    const method = request.method()
    const headers = response.headers()
    const url = response.url()
    const status = response.status()
    const statusText = response.statusText()
    const remoteAddress = response.remoteAddress()
    // console.debug('PUPPETEER response:response', remoteAddress.ip, remoteAddress.port, method, url, status, statusText, JSON.stringify(headers, null, 0))

    const securityDetails = response.securityDetails()
    if (securityDetails) {
      const issuer = securityDetails.issuer()
      const subjectName = securityDetails.subjectName()
      const validFrom = securityDetails.validFrom()
      const validTo = securityDetails.validTo()
      const protocol = securityDetails.protocol()
      const subjectAlternativeNames = securityDetails.subjectAlternativeNames()
      console.debug('PUPPETEER response:issuer', issuer)
      console.debug('PUPPETEER response:subjectName', subjectName)
      console.debug('PUPPETEER response:valid', validFrom, validTo)
      console.debug('PUPPETEER response:protocol', protocol)
      console.debug('PUPPETEER response:altNames', subjectAlternativeNames)
    }

    // if (status >= 200 && status < 300) {
    //   const html = await response.text()
    //   console.debug('PUPPETEER response:body', html.slice(0, 100))
    // }
  }

  async setupPage (browser, url) {
    // console.debug('PUPPETEER page:new', url)
    const page = await browser.newPage()
    // await page.setRequestInterception(true)

    page.on('request', async (request) => {
      console.debug('PUPPETEER REQUEST', request.url())

      // if (request.isInterceptResolutionHandled()) {
      //   return
      // }

      // return request.continue()
    })

    page.on('response', async (response) => {
      console.debug('PUPPETEER RESPONSE', response.url())
      const request = response.request()

      if (request.resourceType() !== 'document') {
        return
      }

      await this.logResponse(response)
    })

    page.on('requestfinished', async (request) => {
      // console.debug('PUPPETEER requestfinished', request.method(), request.url())
    })

    if (url) {
      console.debug('PUPPETEER opening url', url)
      await page.goto(url)

      try {
        await page.waitForNetworkIdle({
          timeout: 3000
        })
        console.debug('PUPPETEER navigated to', url)
      } catch (err) {
        console.error('Error opening page', url, err)
        throw new Error('Error opening page')
      }
    }

    return page
  }

  async submitForm (page, options) {
    const { form, fields, submit } = options || {}

    await page.waitForSelector(form)
    await page.waitForSelector(submit)

    const formElement = await page.$(form)

    // console.debug('PUPPETEER form', form)
    for (const [name, value] of Object.entries(fields)) {
      await formElement.waitForSelector(name)

      const input = await formElement.$(name)

      let realValue = value
      if (typeof value === 'function') {
        realValue = await value()
      }

      if (Array.isArray(realValue)) {
        await input.select(...realValue)
        // console.debug('PUPPETEER select', name, ...realValue)
      } else {
        await input.click()
        await input.type(realValue, { delay: 100 })
        // console.debug('PUPPETEER input', name, realValue)
      }
    }

    const button = await formElement.$(submit)
    console.debug('PUPPETEER submit', submit, JSON.stringify(fields, null, 0))

    const [submitResponse] = await Promise.all([
      page.waitForNavigation({
        timeout: 30000
      }),
      button.click()
    ])

    await this.logResponse(submitResponse)
  }
}

module.exports = Puppet
