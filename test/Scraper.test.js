const sinon = require('sinon')
const { describe, it } = require('mocha')
const Scraper = require('../src/Scraper')
const http = require('http')
const { expect } = require('chai')
const config = require('../config')

describe('Proxy Test', () => {
  it('GET through proxy. Got revoked OCSP error', (done) => {
    const testScraper = new Scraper(Object.assign(config.clone('scrapers.oscpTest'), {}))

    const testProxy = testScraper.createProxy()
    sinon.stub(testScraper, 'shouldCheckOcsp').returns(true)
    sinon.stub(testScraper, 'store').resolves()

    testProxy.on('error', (err) => {
      expect(err.message).to.be.equal('OCSP Status: revoked')
      testProxy.close()
      done()
    })

    http.request({
      host: 'localhost',
      port: 8080,
      path: '/',
      method: 'GET'
    }).end()
  }).timeout(0)

  it('GET through proxy. Successfull get data', (done) => {
    const testScraper = new Scraper(Object.assign(config.clone('scrapers.test'), {}))
    // sinon.stub(Agent.prototype, 'handleOCSPResponse' ).throws(new Error('file not found'))

    const testProxy = testScraper.createProxy()
    sinon.stub(testScraper, 'shouldCheckOcsp').returns(true)
    sinon.stub(testScraper, 'store').resolves()

    http.request({
      host: 'localhost',
      port: 8080,
      path: '/get',
      method: 'GET'
    },
    (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        expect(JSON.parse(data)).to.be.an('object')
        expect(JSON.parse(data).url).to.be.equal('https://www.httpbin.org/get')
        testProxy.close()
        done()
      })
    }).end()
  })

  it('POST through proxy. Successfull post data', (done) => {
    const testScraper = new Scraper(Object.assign(config.clone('scrapers.test'), {}))
    // sinon.stub(Agent.prototype, 'handleOCSPResponse' ).throws(new Error('file not found'))

    const testProxy = testScraper.createProxy()
    sinon.stub(testScraper, 'shouldCheckOcsp').returns(true)
    sinon.stub(testScraper, 'store').resolves()

    const req = http.request({
      host: 'localhost',
      port: 8080,
      path: '/post',
      method: 'POST'
    },
    (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        expect(JSON.parse(data)).to.be.an('object')
        expect(JSON.parse(data).data).to.be.equal('exampleString')
        testProxy.close()
        done()
      })
    })
    req.write('exampleString')
    req.end()
  })
})
