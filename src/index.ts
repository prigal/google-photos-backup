import { chromium } from 'playwright-extra'
import stealth from 'puppeteer-extra-plugin-stealth'
import path from 'path'
import fsP from 'node:fs/promises'
import { moveFile } from '@npmcli/fs'
import { ExifDateTime, exiftool } from 'exiftool-vendored'
import { program } from "commander"
import { mkdir } from 'fs/promises'
import { Page } from 'playwright-core'

const stealthPlugin = stealth()
stealthPlugin.enabledEvasions.delete('iframe.contentWindow');
stealthPlugin.enabledEvasions.delete('media.codecs')

chromium.use(stealthPlugin)

console.log = (function() {
  var console_log = console.log;
  var timeStart = new Date().getTime();
  
  return function() {
    var delta = new Date().getTime() - timeStart;
    var args = [];
    args.push(new Date().toLocaleString('fr')   + ' (');
    args.push((delta / 1000).toFixed(2) + ') :');
    for(var i = 0; i < arguments.length; i++) {
      args.push(arguments[i]);
    }
    console_log.apply(console, args);
  };
})();

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const getProgress = async (downloadPath: string): Promise<string> => {
  const lastDone = await fsP.readFile(path.join(downloadPath, '.lastdone'), 'utf-8')
  if (lastDone === '') throw new Error("empty file")
  return lastDone
}

const saveProgress = async (photoDirectory: string, url: string): Promise<void> => {
  await mkdir(photoDirectory, { recursive: true })
  await fsP.writeFile(path.join(photoDirectory, '.lastdone'), url, 'utf-8')
}

/*
  This function is used to get the latest photo in the library. Once Page is loaded,
  We press right click, It will select the latest photo in the grid. And then
  we get the active element, which is the latest photo.
*/
const getLatestPhoto = async (page: Page) => {
  await sleep(2000)
  await page.keyboard.press('ArrowRight')
  await sleep(500)
  return await page.evaluate(() => (document.activeElement as HTMLLinkElement)?.href)
}

// remove /u/0/
const clean = (link: string) => {
  return link.replace(/\/u\/\d+\//, '/')
}

const start = async (
  {
    headless,
    photoDirectory,
    sessionDirectory,
    initialPhotoUrl,
    writeScrapedExif,
    flatDirectoryStructure,
    browserLocale,
    browserTimezoneId
  }: {
    headless: boolean,
    photoDirectory: string,
    sessionDirectory: string,
    initialPhotoUrl: string,
    writeScrapedExif: boolean,
    flatDirectoryStructure: boolean,
    browserLocale: string,
    browserTimezoneId: string
  }
): Promise<void> => {
  let startLink: string
  try {
    startLink = await getProgress(photoDirectory)
  } catch (e) {
    console.log("Empty or non-existing .lastdone file")
    if (initialPhotoUrl) {
      console.log(`Populating from --initial-photo-url parameter: ${initialPhotoUrl}`)
      await saveProgress(photoDirectory, initialPhotoUrl)
      startLink = initialPhotoUrl
    } else {
      console.error('Please pass initial photo url using the --initial-photo-url parameter or manually populate the .lastdone file in your photo directory')
      return process.exit(1)
    }
  }
  console.log(`Chrome session directory: ${sessionDirectory} (${await (async () => {
    try {
      return (await fsP.readdir(sessionDirectory)).length + ' children'
    } catch (e) {
      return e
    }
  })()})`)
  console.log('Starting from:', new URL(startLink).href)

  const browser = await chromium.launchPersistentContext(path.resolve(sessionDirectory), {
    headless,
    acceptDownloads: true,
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    locale: browserLocale,
    timezoneId: browserTimezoneId
  })

  const cleanup = async () => {
    await browser.close()
    await exiftool.end()
  }

  const page = await browser.newPage()

  const mainGooglePhotosUrl = "https://photos.google.com/"

  await page.goto(mainGooglePhotosUrl)

  const pageUrl = page.url()

  if (pageUrl !== mainGooglePhotosUrl) {
    console.error(`Page was redirected to ${pageUrl}, please authenticate first using the 'setup' command`)
    await cleanup()
    return process.exit(1)
  }

  const latestPhoto = await getLatestPhoto(page)
  if (!latestPhoto) {
    console.error('Could not determine latest photo')
    await cleanup()
    return process.exit(1)
  }
  console.log('Latest Photo:', latestPhoto)
  console.log('-------------------------------------')

  await page.goto(clean(startLink))

  await sleep(1000)
  /*
    We download the first (Oldest) photo and overwrite it if it already exists. Otherwise running first time, it will skip the first photo.
  */

  console.log(page.url() + ' : START')

  await downloadPhoto(
    page,
    {
      photoDirectory,
      overwrite: true,
      writeScrapedExif,
      flatDirectoryStructure
    }
  )

  while (true) {
    const currentUrl = await page.url()

    if (clean(currentUrl) === clean(latestPhoto)) {
      console.log('-------------------------------------')
      console.log('Reached the latest photo, exiting...')
      break
    }

    /*
      We click on the left side of arrow in the html. This will take us to the previous photo.
      Note: I have tried both left arrow press and clicking directly the left side of arrow using playwright click method.
      However, both of them are not working. So, I have injected the click method in the html.
    */
    // TODO check if better class name is avalable
    await page.evaluate(() => (document.getElementsByClassName('SxgK2b OQEhnd')[0] as HTMLElement).click())

    // we wait until new photo is loaded
    await page.waitForURL((url) => {
      return url.host === 'photos.google.com' && url.href !== currentUrl
    })

    console.log(page.url() + ' : START')

    await downloadPhoto(
      page,
      {
        photoDirectory: photoDirectory,
        writeScrapedExif: writeScrapedExif
      }
    )
    await saveProgress(photoDirectory, page.url())
  }
  await cleanup()
}

const setup = async (sessionDirectory: string,browserLocale: string,browserTimezoneId: string) => {
  const browser = await chromium.launchPersistentContext(path.resolve(sessionDirectory), {
    headless: false,
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    locale: browserLocale,
    timezoneId: browserTimezoneId
  })
  const page = await browser.newPage()
  await page.goto('https://photos.google.com/')

  console.log('Close browser once you are logged inside Google Photos')
}

const downloadPhoto = async (page: Page, {
  photoDirectory,
  overwrite = false,
  writeScrapedExif = false,
  flatDirectoryStructure = false
}: {
  photoDirectory: string,
  overwrite?: boolean,
  writeScrapedExif?: boolean
  flatDirectoryStructure?: boolean
}): Promise<void> => {
  const downloadPromise = page.waitForEvent('download', {timeout:100000})

  await page.keyboard.down('Shift')
  await page.keyboard.press('KeyD')

  const download = await downloadPromise
  const tempPath = await download.path()
  const suggestedFilename = await download.suggestedFilename()

  if (!tempPath) {
    console.error('\x1b[31m'," - Could not download file", '\x1b[0m')
    process.exit(1)
  }

  const metadata = await exiftool.read(tempPath)
  const dateTimeOriginal = (metadata.DateTimeOriginal as ExifDateTime)

  let year = dateTimeOriginal?.year || 1970
  let month = dateTimeOriginal?.month || 1

  if (year === 1970 && month === 1) {
    // if metadata is not available, we try to get the date from the html
    console.log(' - Metadata not found, trying to get date from html')
    const data = await page.request.get(page.url())
    const html = await data.text()

    // RegEx only works for English
    const regex = /aria-label="(?:Photo|Video) ((?:[–-]) ([^"–-]+))+"/
    const match = regex.exec(html)


    const lastMatch = match?.pop()
    if (lastMatch) {
      console.log(` - Metadata in HTML: ${lastMatch}`)
      const date = new Date(lastMatch)
      year = date.getFullYear()
      month = date.getMonth() + 1

      if (writeScrapedExif) {
        console.log(" - Scraped datetime saved to exif metadata : "+date)
        await exiftool.write(tempPath, { DateTimeOriginal: ExifDateTime.fromMillis(date.getTime()) })
      }
    } else {
      console.log('\x1b[31m',' - Could not convert date, was language set to french?', '\x1b[0m')
    }
  }

  const destDir = flatDirectoryStructure
    ? path.join(photoDirectory, suggestedFilename)
    : path.join(photoDirectory, `${year}`, `${month}`, suggestedFilename)

  try {
    await moveFile(tempPath, destDir, { overwrite })
    console.log('\x1b[32m', ' - Download Complete: '+ destDir, '\x1b[0m')
  } catch (error) {
    console.log('\x1b[31m',` - Could not move file to ${destDir}: ${error}`, '\x1b[0m')
  }
}


program
  .name('google-photos-backup')
  .description('Backup your google photos library using playwright')

program
  .command("start")
  .option('--headless <value>', 'Run browser in headless mode', 'true')
  .option('--photo-directory <value>', 'Directory to download photos to', './download')
  .option('--session-directory <value>', 'Chrome session directory', './session')
  .option('--initial-photo-url <value>', 'URL of your oldest photo. This parameter is only used when the .lastdone file is not available')
  .option('--write-scraped-exif', 'When no data metadata is available, set scraped webpage date data as metadata', false)
  .option('--flat-directory-structure', 'Insteas of using a nested folder structure (year, month), download all photos to a single folder', false)
  .option('--browser-locale <value>', 'Emulate specific locale', 'en-US')
  .option('--browser-timezone-id <value>', 'Emulate specific timezone id', 'UTC')
  .action(options => {
    start({
      headless: options.headless === "true",
      photoDirectory: options.photoDirectory,
      sessionDirectory: options.sessionDirectory,
      initialPhotoUrl: options.initialPhotoUrl,
      writeScrapedExif: options.writeScrapedExif,
      flatDirectoryStructure: options.flatDirectoryStructure,
      browserLocale: options.browserLocale,
      browserTimezoneId: options.browserTimezoneId
    })
  })

program
  .command('setup')
  .option('--session-directory <value>', 'Chrome session directory', './session')
  .option('--browser-locale <value>', 'Emulate specific locale', 'en-US')
  .option('--browser-timezone-id <value>', 'Emulate specific timezone id', 'UTC')
  .action(options => {
    setup(options.sessionDirectory, options.browserLocale, options.browserTimezoneId)
  })

program.parse()