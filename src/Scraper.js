const httpProxy = require('http-proxy')
const fs = require('fs')
const path = require('path')
const Puppet = require('./Puppet')
const ocsp = require('@techteamer/ocsp')
const proxyaddr = require('proxy-addr')
const dns = require('dns').promises

// Symbol to.promises store scraper specific data on request objects
const REQ_SESS_SYMBOL = Symbol('REQ_SESS')

class Scraper {
  /**
   * @param {Object} scraperOptions
   * @param {function(Puppet, Browser)} scraperOptions.scraper scraper callback to perform tasks in Puppeteer
   * @param {Console} scraperOptions.logger logger instance
   * @param {Number} scraperOptions.port Proxy server port
   * @param {Object} scraperOptions.browser Puppeteer options
   * @param {Object} scraperOptions.proxy http-proxy options
   * @param {Object} [scraperOptions.ocsp] OCSP checking options
   * @param {Agent} scraperOptions.ocsp.agent OCSP Agent
   * @param {function(URL, ClientRequest, IncomingMessage, ServerResponse) : Boolean} scraperOptions.ocsp.shouldCheckOcsp filter OCSP checking
   * @param {Object} [scraperOptions.save] Options to save requests and responses
   * @param {String} scraperOptions.save.rootDir root dir for saving requests and responses
   * @param {String | Array} scraperOptions.ipFilter Trusted IP filter for target host
   */
  constructor (scraperOptions) {
    this.options = scraperOptions
    this.proxyPort = this.options.port || 8080
    this.proxyHost = `http://localhost:${this.proxyPort}`
    this.logger = this.options.logger || global.console
    this.proxyStartDate = null
    this.proxy = null
    this.puppet = null
    this._resolve = null
    this._reject = null
    this._resultPromise = null
    this.ipFilter = this.options.ipFilter
    this.ocspAgent = null
  }

  async scrape () {
    this._resultPromise = new Promise((resolve, reject) => {
      this._resolve = resolve
      this._reject = reject
    })

    this._resultPromise.catch(() => {
      // handle unhandled rejection from exit calls
    })

    if (this._doFilter()) {
      await this._targetAddressIPFilter(this.ipFilter, this.options.proxy.target.host)
    }

    this.proxy = this.createProxy()
    this.puppet = new Puppet(this.proxyHost, this.options.browser)

    let results
    try {
      results = await this.puppet.browse((puppet, browser) => {
        return this.scraper(puppet, browser)
      })
    } catch (err) {
      if (!this.puppet && !this.proxy) {
        // NOTE: it's normal to receive an error here if TLS was rejected
        // because the browser is abruptly closed during a connection
        // e.g.: Protocol error (Page.navigate): Target closed.
        this.logger.warn('Proxy connection failed')
        return this._resultPromise
      }
      this.logger.error('Error in browser session', err)
      throw new Error('Error in browser session')
    }

    this._exit(null, results)

    return this._resultPromise
  }

  _exit (err, results) {
    if (this.puppet) {
      this.puppet.close().catch((puppeteerCloseError) => {
        this.logger.error('Error closing Puppeteer browser', puppeteerCloseError)
      })
      this.puppet = null
    }
    if (this.proxy) {
      this.proxy.close()
      this.proxy = null
    }

    if (err) {
      if (this._reject) {
        this._reject(err)
      }
    } else {
      if (this._resolve) {
        this._resolve(results)
      }
    }
  }

  _getSaveRoot () {
    const date = this.proxyStartDate
    const dateTag = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}-${date.getSeconds()}`
    return path.join(this.options.save.rootDir, dateTag)
  }

  _createSavePath (url, method, type) {
    return path.join(this._getSaveRoot(), url.hostname, `${url.pathname}.${method}.${type}`)
  }

  _canSave () {
    return !!(this.options.save && this.options.save.rootDir)
  }

  _formatRawHeaders (rawHeadersArray, indent = '') {
    let rawHeaders = ''
    for (const [index, item] of rawHeadersArray.entries()) {
      if (index % 2) {
        rawHeaders += ` ${item}${index + 1 < rawHeadersArray.length ? '\n' : ''}`
      } else {
        rawHeaders += `${indent}${item}:`
      }
    }
    return rawHeaders
  }

  createProxy () {
    if (this.options.ocsp && this.options.ocsp.agent) {
      if (this.options.ocsp.agent instanceof ocsp.Agent) {
        this.ocspAgent = this.options.ocsp.agent
      } else {
        this.ocspAgent = new ocsp.Agent()
      }
    }

    const proxy = httpProxy.createProxy({
      secure: true,
      changeOrigin: true,
      selfHandleResponse: false,
      xfwd: false,
      ...this.options.proxy,
      agent: new ocsp.Agent()
    })

    this.proxyStartDate = new Date()

    proxy.on('error', (err, req, res) => {
      this._exit(new Error('Error during proxy connection', err.code, err.message))
    })

    proxy.on('proxyReq', async (proxyReq, req, res, options) => {
      const requestUrl = new URL(`${proxyReq.protocol}${proxyReq.host}${proxyReq.path}`)
      // const method = proxyReq.method
      // const href = requestUrl.href
      // const logHeaders = this.options.loggerOptions.verbosity.logHeaders
      // const rawHeaders = logHeaders
      //   ? '\n' + this._formatRawHeaders(req.rawHeaders, '  ')
      //   : ''

      proxyReq.setHeader('referer', requestUrl.origin)

      if (this.options.ocsp && this.options.ocsp.agent) {
        if (this.shouldCheckOcsp(requestUrl, proxyReq, req, res)) {
          options.agent = this.ocspAgent
        } else {
          options.agent = null
        }
      }

      const scraperData = {
        requestUrl,
        ocspCheck: !!options.agent
      }
      req[REQ_SESS_SYMBOL] = scraperData

      if (this._canSave()) {
        const chunks = []
        req.on('data', (chunk) => {
          chunks.push(chunk)
        })
        req.on('end', async () => {
          const body = Buffer.concat(chunks).toString()
          await this.store(body, 'request', { requestUrl, method: req.method, file: 'req.txt' })
        })
      }
    })

    proxy.on('proxyRes', async (proxyRes, req, res) => {
      const {
        requestUrl,
        ocspCheck
      } = req[REQ_SESS_SYMBOL]
      const tlsSocket = proxyRes.socket.ssl || proxyRes.socket
      // const protocolVersion = tlsSocket.getProtocol()
      // const method = req.method
      // const href = requestUrl.href
      // const statusCode = proxyRes.statusCode
      // const statusMessage = proxyRes.statusMessage
      // const ip = proxyRes.socket.remoteAddress
      // const logHeaders = this.options.loggerOptions.verbosity.logHeaders
      // const rawHeaders = logHeaders
      //   ? '\n' + this._formatRawHeaders(req.rawHeaders, '  ')
      //   : ''

      if (this._canSave()) {
        const chunks = []
        proxyRes.on('data', (chunk) => {
          chunks.push(chunk)
        })
        proxyRes.on('end', async () => {
          const body = Buffer.concat(chunks).toString()
          await this.store(body, 'request', { requestUrl, method: req.method, file: 'res.txt' })
        })

        if (ocspCheck) {
          const cert = tlsSocket.getPeerCertificate(true)
          // log cert based on verbosity
          if (cert) {
            await this.store(cert.raw, 'cert', { requestUrl, method: req.method, file: 'res.cert.txt' })
            const issuer = cert.issuerCertificate
            if (issuer) {
              await this.store(issuer.raw, 'issuer', { requestUrl, method: req.method, file: 'res.cert.txt' })
            }
          }
        }
      }
    })

    proxy.listen(this.proxyPort)
    this.logger.log('PROXY LISTENING', this.proxyPort)

    return proxy
  }

  /**
   * Filter OCSP checking
   *
   * @param {URL} requestUrl
   * @param {ClientRequest} proxyReq request to proxied host
   * @param {IncomingMessage} req request from original client
   * @param {ServerResponse} res response to original client
   * @return {boolean}
   */
  shouldCheckOcsp (requestUrl, proxyReq, req, res) {
    return this.options.ocsp &&
      typeof this.options.ocsp.shouldCheckOcsp === 'function' &&
      !!this.options.ocsp.shouldCheckOcsp(requestUrl, proxyReq, req, res)
  }

  /**
   * @param {Puppet} puppet
   * @param {Browser} browser
   */
  async scraper (puppet, browser) {
    if (typeof this.options.scraper === 'function') {
      return this.options.scraper(puppet, browser)
    }
  }

  _doFilter () {
    return !!this.ipFilter
  }

  async _targetAddressIPFilter (ipFilter, targetHost) {
    try {
      const hostIp = await dns.lookup(targetHost)
      if (!proxyaddr.compile(ipFilter)(hostIp.address)) {
        throw new Error('Untrusted target IP: ' + hostIp.address)
      }
    } catch (error) {
      throw new Error('Invalid configuration: ipFilter: ' + error.message)
    }
  }

  /**
  * Request/Response/Cert storing
  *
  * @param {String} data (Cert,Req/Res)
  * @param {String} dataType type of the data
  * @param {URL} requestUrl request from original client
  * @param {String} method request method
  */
  async store (data, dataType, requestUrl, method) {
    const savePath = this._createSavePath(requestUrl, method, dataType)
    fs.mkdirSync(path.dirname(savePath), { recursive: true })
    fs.writeFileSync(savePath, data)
  }
}

module.exports = Scraper
