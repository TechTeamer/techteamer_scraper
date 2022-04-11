const httpProxy = require('http-proxy')
const fs = require('fs')
const path = require('path')
const Puppet = require('./Puppet')
const ocsp = require('@techteamer/ocsp')

// Symbol to store scraper specific data on request objects
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
  }

  async scrape () {
    this._resultPromise = new Promise((resolve, reject) => {
      this._resolve = resolve
      this._reject = reject
    })

    this._resultPromise.catch(() => {
      // handle unhandled rejection from exit calls
    })

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
    const dateTag = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}-${date.getSeconds()}`
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
    const proxy = httpProxy.createProxy({
      secure: true,
      changeOrigin: true,
      selfHandleResponse: false,
      xfwd: false,
      ...this.options.proxy
    })

    this.proxyStartDate = new Date()

    proxy.on('error', (proxyError) => {
      this.logger.error('Error during proxy connection', proxyError)
      this._exit(new Error('Error during proxy connection'))
    })

    // proxy.on('start', (req, res, targetOrForward) => {
    //   console.error('PROXY START')
    // })

    proxy.on('proxyReq', (proxyReq, req, res, options) => {
      const requestUrl = new URL(`${proxyReq.protocol}${proxyReq.host}${proxyReq.path}`)
      const method = proxyReq.method
      const href = requestUrl.href
      const logHeaders = this.options.loggerOptions.verbosity.logHeaders
      const rawHeaders = logHeaders
        ? '\n' + this._formatRawHeaders(req.rawHeaders, '  ')
        : ''

      proxyReq.setHeader('referer', requestUrl.origin)

      this.logger.log('PROXY REQ', method, href, rawHeaders)

      if (this.options.ocsp && this.options.ocsp.agent) {
        if (this.shouldCheckOcsp(requestUrl, proxyReq, req, res)) {
          // this.logger.log('PROXY OCSP', requestUrl.href)
          const ocspAgent = new ocsp.Agent(this.options.ocsp.agent)
          // ocspAgent.on('certificate', (certificate) => {
          //   console.log('PROXY RESPONSE CERT', certificate)
          // })
          // ocspAgent.on('OCSPError', (certificate) => {
          //   console.log('PROXY RESPONSE CERT', certificate)
          // })
          options.agent = ocspAgent
        } else {
          options.agent = null
        }
      }

      // const chunks = []
      // req.on('data', (chunk) => {
      //   chunks.push(chunk)
      //   console.log('PROXY REQUEST DATA', req.method, req.url, chunk)
      // })
      // req.on('end', () => {
      //   const body = Buffer.concat(chunks).toString()
      //   console.log("PROXY REQUEST BODY", req.method, req.url, body.slice(0, 100))
      // })

      const scraperData = {
        requestUrl,
        ocspCheck: !!options.agent
      }
      req[REQ_SESS_SYMBOL] = scraperData

      if (this._canSave()) {
        const responsePath = this._createSavePath(requestUrl, proxyReq.method, 'res.txt')
        fs.mkdirSync(path.dirname(responsePath), { recursive: true })
        req.pipe(fs.createWriteStream(responsePath))
        // this.logger.log('PROXY REQ SAVED', responsePath)
      }
    })

    proxy.on('proxyRes', (proxyRes, req, res) => {
      const {
        requestUrl,
        ocspCheck
      } = req[REQ_SESS_SYMBOL]
      const tlsSocket = proxyRes.socket.ssl || proxyRes.socket
      const protocolVersion = tlsSocket.getProtocol()
      const method = req.method
      const href = requestUrl.href
      const statusCode = proxyRes.statusCode
      const statusMessage = proxyRes.statusMessage
      const ip = proxyRes.socket.remoteAddress
      const logHeaders = this.options.loggerOptions.verbosity.logHeaders
      const rawHeaders = logHeaders
        ? '\n' + this._formatRawHeaders(req.rawHeaders, '  ')
        : ''

      // RAW Response from the target
      this.logger.log('PROXY RES', method, href, ip, protocolVersion, statusCode, statusMessage, rawHeaders)

      // const chunks = []
      // proxyRes.on('data', (chunk) => {
      //   chunks.push(chunk)
      //   console.log('PROXY RESPONSE DATA', req.method, req.url, chunk)
      // })
      // proxyRes.on('end', () => {
      //   const body = Buffer.concat(chunks).toString()
      //   console.log("PROXY RESPONSE BODY", req.method, req.url, body.slice(0, 100)) // original response from target server
      //   // res.end(body) // modified response to client
      // })

      if (this._canSave()) {
        const responsePath = this._createSavePath(requestUrl, req.method, 'res.txt')
        fs.mkdirSync(path.dirname(responsePath), { recursive: true })
        proxyRes.pipe(fs.createWriteStream(responsePath))
        // this.logger.log('PROXY RES SAVED', responsePath)

        if (ocspCheck) {
          const cert = tlsSocket.getPeerCertificate(true)
          // log cert based on verbosity

          if (cert) {
            const certPath = this._createSavePath(requestUrl, req.method, 'res.cert.txt')
            fs.writeFileSync(certPath, cert.raw)
            // this.logger.log('PROXY RESPONSE SAVED CERT', certPath)

            const issuer = cert.issuerCertificate
            if (issuer) {
              const issuerPath = this._createSavePath(requestUrl, req.method, 'res.issuer.txt')
              fs.writeFileSync(issuerPath, issuer.raw)
              // this.logger.log('PROXY RESPONSE SAVED ISSUER', issuerPath)
            }
          }
        }
      }
    })

    // proxy.on('open', (proxySocket) => {
    //   // listen for messages coming FROM the target here
    //   console.log('PROXY SOCKET', proxySocket)
    //   proxySocket.on('data', (data) => {
    //     console.log('PROXY SOCKET data', data)
    //   })
    // })

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
}

module.exports = Scraper
