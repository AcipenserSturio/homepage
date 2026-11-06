// What a new visitor sees until they edit or import something. Unsaved, so it can change
// in a later build for anyone who hasn't customised the page.

const link = (name, url, icon) => ({ name, url, icon });

export const defaultPreferences = {
  version: 1,
  location: null,
  groups: [
    {
      name: 'Social',
      links: [
        link('Reddit', 'https://www.reddit.com', 'si:reddit'),
        link('YouTube', 'https://www.youtube.com', 'si:youtube'),
        link('Bluesky', 'https://bsky.app', 'si:bluesky'),
        link('Discord', 'https://discord.com/app', 'si:discord'),
        link('Twitch', 'https://www.twitch.tv', 'si:twitch'),
        link('Tumblr', 'https://tumblr.com/', 'si:tumblr'),
      ],
    },
    {
      name: 'Learning',
      links: [
        link('Wikipedia', 'https://www.wikipedia.org', 'si:wikipedia'),
        link('Internet Archive', 'https://archive.org', 'si:internetarchive'),
        link('Stack Overflow', 'https://stackoverflow.com', 'si:stackoverflow'),
        link('Wiktionary', 'https://en.wiktionary.org/wiki/Wiktionary:Main_Page', 'lucide:book-search'),
        link('Thesaurus', 'https://www.thesaurus.com/', 'lucide:book-type'),
      ],
    },
    {
      name: 'Games',
      links: [
        link('Steam', 'https://store.steampowered.com', 'si:steam'),
        link('itch.io', 'https://itch.io', 'si:itchdotio'),
        link('Lichess', 'https://lichess.org/', 'lucide:crown'),
        link('Wordle', 'https://www.nytimes.com/games/wordle/index.html', 'lucide:grid-3x3'),
        link('GeoGuessr', 'https://www.geoguessr.com', 'lucide:earth'),
      ],
    },
    {
      name: 'Content',
      links: [
        link('Netflix', 'https://www.netflix.com', 'si:netflix'),
        link('Spotify', 'https://open.spotify.com', 'si:spotify'),
        link('SoundCloud', 'https://soundcloud.com', 'si:soundcloud'),
      ],
    },
    {
      name: 'Tools',
      links: [
        link('GitHub', 'https://github.com', 'si:github'),
        link('Dropbox', 'https://www.dropbox.com', 'si:dropbox'),
      ],
    },
    {
      name: 'News',
      links: [
        link('Reuters', 'https://www.reuters.com', 'lucide:newspaper'),
        link('AP News', 'https://apnews.com', 'lucide:radio-tower'),
        link('BBC News', 'https://www.bbc.com/news', 'lucide:tv'),
      ],
    },
    {
      name: 'Google',
      links: [
        link('Gmail', 'https://mail.google.com', 'si:gmail'),
        link('Drive', 'https://drive.google.com', 'si:googledrive'),
        link('Docs', 'https://docs.google.com/document/u/0/', 'si:googledocs'),
        link('Sheets', 'https://docs.google.com/spreadsheets/u/0/', 'si:googlesheets'),
        link('Calendar', 'https://calendar.google.com', 'si:googlecalendar'),
        link('Maps', 'https://www.google.com/maps', 'si:googlemaps'),
        link('Photos', 'https://photos.google.com', 'si:googlephotos'),
        link('Translate', 'https://translate.google.com', 'si:googletranslate'),
      ],
    },
  ],
};
