const puppeteer = require('puppeteer')

class Puppet {
  /**
   * @param {String} host Local proxy host
   * @param {Object} puppetOptions
   * @param {Boolean} puppetOptions.autoClose auto close browser window after the scraper function finishes
   * @param {Object} puppetOptions.puppeteer Puppeteer options
   */
  constructor (host, puppetOptions) {
    this.options = puppetOptions
    this.host = host
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
        return
      }

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
    // const securityDetails = response.securityDetails()
    // if (securityDetails) {
    //   const issuer = securityDetails.issuer()
    //   const subjectName = securityDetails.subjectName()
    //   const validFrom = securityDetails.validFrom()
    //   const validTo = securityDetails.validTo()
    //   const protocol = securityDetails.protocol()
    //   const subjectAlternativeNames = securityDetails.subjectAlternativeNames()
    //   console.debug('PUPPETEER response:issuer', issuer)
    //   console.debug('PUPPETEER response:subjectName', subjectName)
    //   console.debug('PUPPETEER response:valid', validFrom, validTo)
    //   console.debug('PUPPETEER response:protocol', protocol)
    //   console.debug('PUPPETEER response:altNames', subjectAlternativeNames)
    // }
  }

  async setupPage (browser, url) {
    const page = await browser.newPage()

    page.on('response', async (response) => {
      const request = response.request()

      if (request.resourceType() !== 'document') {
        return
      }

      await this.logResponse(response)
    })

    if (url) {
      const uri = `${this.host}${url}`
      await page.goto(uri)

      try {
        await page.waitForNetworkIdle({
          timeout: 3000
        })
      } catch (err) {
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

    for (const [name, value] of Object.entries(fields)) {
      await formElement.waitForSelector(name)

      const input = await formElement.$(name)

      let realValue = value
      if (typeof value === 'function') {
        realValue = await value()
      }

      if (Array.isArray(realValue)) {
        await input.select(...realValue)
      } else {
        await input.click()
        await input.type(realValue, { delay: 100 })
      }
    }

    const button = await formElement.$(submit)

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
