const { expect } = require('chai')
const { describe, it } = require('mocha')
const sinon = require('sinon')
const Scraper = require('../src/Scraper')
const config = require('../config')

describe('Scraping the form', () => {
  it('able to POST the form data and get proper response', async () => {
    const testScraper = new Scraper(Object.assign(config.clone('scrapers.test'), {}))

    // ocsp check enabled
    sinon.stub(testScraper, 'shouldCheckOcsp').returns(true)

    // do not store but called
    sinon.stub(testScraper, 'store').resolves()

    testScraper.scraper = async function (puppet, browser) {
      let response
      const page = await puppet.setupPage(browser, '/forms/post')

      page.on('response', async (res) => {
        if (res.url() === 'http://localhost:8080/post') {
          response = await res.json()
        }
      })

      await page.waitForNetworkIdle()

      const navigationPromise = page.waitForNavigation({
        timeout: 30000
      })

      const submitPromise = await puppet.submitForm(page, {
        form: 'form',
        submit: 'button',
        fields: {
          '[name="custname"]': 'Jon Doe',
          '[name="custtel"]': '+36001234567',
          '[name="custemail"]': 'email@example.email',
          '[name="delivery"]': '07:15PM'
        }
      })

      await Promise.all([
        navigationPromise,
        page.waitForNetworkIdle(),
        submitPromise
      ])

      return response
    }

    const result = await testScraper.scrape()

    sinon.assert.called(testScraper.store)
    sinon.assert.called(testScraper.shouldCheckOcsp)

    expect(result.form.custemail).to.be.a('string').equal('email@example.email')
    expect(result.form.custname).to.be.a('string').equal('Jon Doe')
    expect(result.form.custtel).to.be.a('string').equal('+36001234567')
    expect(result.form.delivery).to.be.a('string').equal('19:15')
  }).timeout(10000)
})
