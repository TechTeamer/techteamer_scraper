const CssScraper = require('../scrapers/css')
const scraper = new CssScraper()

scraper.scrape().then(() => {
  console.log('Finished scraping CSS')
  process.exit()
}).catch((err) => {
  console.error('Failed to scrape CSS', err)
  process.exit(1)
})
