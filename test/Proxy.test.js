const sinon = require('sinon')
const { describe, it, afterEach } = require('mocha')
const Scraper = require('../src/Scraper')
const http = require('http')
const { expect } = require('chai')
const config = require('../config')

const randomPort = () => Math.floor(Math.random() * (9000 - 8000 + 1) + 8000)

describe('Proxy Test', () => {
  afterEach(() => {
    sinon.restore()
  })

  it('GET through proxy. Get revoked OCSP error', (done) => {
    const testPort = randomPort()
    const testScraper = new Scraper(Object.assign(config.clone('scrapers.ocspTest'), { port: testPort }))

    sinon.stub(testScraper, 'shouldCheckOcsp').returns(true)
    sinon.stub(testScraper, 'store').resolves()

    const testProxy = testScraper.createProxy()

    testProxy.on('error', (err) => {
      expect(err.message).to.be.equal('OCSP Status: revoked')

      sinon.assert.called(testScraper.shouldCheckOcsp)

      testProxy.close()
      done()
    })

    http.request({
      host: 'localhost',
      port: testPort,
      path: '/',
      method: 'GET'
    }).end()
  })

  it('GET through proxy. successfully get data', (done) => {
    const testPort = randomPort()
    const testScraper = new Scraper(Object.assign(config.clone('scrapers.test'), { port: testPort }))

    sinon.stub(testScraper, 'shouldCheckOcsp').returns(true)
    sinon.stub(testScraper, 'store').resolves()

    const testProxy = testScraper.createProxy()

    http.request({
      host: 'localhost',
      port: testPort,
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

        sinon.assert.called(testScraper.store)
        sinon.assert.called(testScraper.shouldCheckOcsp)

        testProxy.close()
        done()
      })
    }).end()
  })

  it('POST through proxy. successfully post data', (done) => {
    const testPort = randomPort()
    const testScraper = new Scraper(Object.assign(config.clone('scrapers.test'), { port: testPort }))

    sinon.stub(testScraper, 'shouldCheckOcsp').returns(true)
    sinon.stub(testScraper, 'store').resolves()

    const testProxy = testScraper.createProxy()

    const req = http.request({
      host: 'localhost',
      port: testPort,
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

        sinon.assert.called(testScraper.store)
        sinon.assert.called(testScraper.shouldCheckOcsp)

        testProxy.close()
        done()
      })
    })
    req.write('exampleString')
    req.end()
  })
})
