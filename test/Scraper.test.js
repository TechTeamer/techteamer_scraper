const sinon = require('sinon');
const fs = require('fs');
const chai = require('chai');
const { describe } = require('mocha')
const Scraper = require('../src/Scraper')
const http = require('http');
const { expect } = require('chai');


const config = {
    "port": 8080,
    "ocsp": {
        "agent": {}
    },
    "proxy": {
        "target": {
            "protocol": "https:",
            "host": "www.httpbin.org",
            "port": 443,
        }
    },
    "browser": {
        "autoClose": false,
        "puppeteer": {
            "headless": false
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

describe('Proxy Test', () => {

    it('GET through proxy. Got revoked OCSP error', (done) => {
        const testScraper = new Scraper(config)
        //sinon.stub(Agent.prototype, 'handleOCSPResponse' ).throws(new Error('file not found'))
        
        const testProxy = testScraper.createProxy()
        sinon.stub(testScraper, 'shouldCheckOcsp').returns(true)
        sinon.stub(testScraper, 'store').resolves()

        testProxy.on('error', (err) => {
            expect(err.message).to.be.equal('OCSP Status: revoked')
            console.log(err);
            testProxy.close()
            done()
        })

        http.request({
            host: 'localhost',
            port:  8080,
            path: '/',
            method: 'GET'
        }).end()

    }).timeout(0)

    it('GET through proxy. Successfull get data', (done) => {
        const testScraper = new Scraper(config)
        //sinon.stub(Agent.prototype, 'handleOCSPResponse' ).throws(new Error('file not found'))
        
        const testProxy = testScraper.createProxy()
        sinon.stub(testScraper, 'shouldCheckOcsp').returns(true)
        sinon.stub(testScraper, 'store').resolves()

        http.request({
            host: 'localhost',
            port:  8080,
            path: '/get',
            method: 'GET'
        },
        (res)=> {
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

    it.only('POST through proxy. Successfull post data', (done) => {
        const testScraper = new Scraper(config)
        //sinon.stub(Agent.prototype, 'handleOCSPResponse' ).throws(new Error('file not found'))
        
        const testProxy = testScraper.createProxy()
        sinon.stub(testScraper, 'shouldCheckOcsp').returns(true)
        sinon.stub(testScraper, 'store').resolves()

        const req = http.request({
            host: 'localhost',
            port:  8080,
            path: '/post',
            method: 'POST'
        },
        (res)=> {
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