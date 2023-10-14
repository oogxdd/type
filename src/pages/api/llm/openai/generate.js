import OpenAI from 'openai'
import { OpenAIStream, StreamingTextResponse } from 'ai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export const runtime = 'edge'

async function handler(req) {
  const {
    messages = [],
    // model = 'gpt-3.5-turbo-16k',
    model = 'gpt-4',
    //
  } = await req.json()

  const response = await openai.chat.completions.create({
    model,
    messages: [
      // {
      //   role: 'system',
      //   content: `You are web links bookmarks organizer. User will feed you with the list of bookmarks and you will help him organize it better into the folders.

      // Initial folders structure provided by the user is:
      // {
      // "id": "0",
      // "title": "",
      // "children": [
      //   {
      //       "id": "1",
      //       "title": "Bookmarks Bar",
      //       "parentId": "0",
      //       "children": [
      //           {
      //               "id": "1509",
      //               "title": "new era",
      //               "parentId": "1",
      //               "children": []
      //           },
      //           {
      //               "id": "1618",
      //               "title": "music",
      //               "parentId": "1",
      //               "children": []
      //           },
      //           {
      //               "id": "1619",
      //               "title": "politics",
      //               "parentId": "1",
      //               "children": []
      //           },
      //           {
      //               "id": "1620",
      //               "title": "startups",
      //               "parentId": "1",
      //               "children": [
      //                   {
      //                       "id": "1636",
      //                       "title": "machcast",
      //                       "parentId": "1620",
      //                       "children": [
      //                           {
      //                               "id": "1638",
      //                               "title": "timeline",
      //                               "parentId": "1636",
      //                               "children": []
      //                           },
      //                           {
      //                               "id": "1639",
      //                               "title": "marketing",
      //                               "parentId": "1636",
      //                               "children": []
      //                           }
      //                       ]
      //                   }
      //               ]
      //           },
      //           {
      //               "id": "1621",
      //               "title": "education",
      //               "parentId": "1",
      //               "children": []
      //           },
      //           {
      //               "id": "1692",
      //               "title": "font",
      //               "parentId": "1",
      //               "children": []
      //           },
      //           {
      //               "id": "2035",
      //               "title": "assembly_now",
      //               "parentId": "1",
      //               "children": [
      //                   {
      //                       "id": "2037",
      //                       "title": "mb",
      //                       "parentId": "2035",
      //                       "children": []
      //                   }
      //               ]
      //           },
      //           {
      //               "id": "2143",
      //               "title": "1. vector db",
      //               "parentId": "1",
      //               "children": []
      //           },
      //           {
      //               "id": "2154",
      //               "title": "_mori_general_",
      //               "parentId": "1",
      //               "children": [
      //                   {
      //                       "id": "2181",
      //                       "title": "image embeddings",
      //                       "parentId": "2154",
      //                       "children": []
      //                   },
      //                   {
      //                       "id": "2203",
      //                       "title": "maps",
      //                       "parentId": "2154",
      //                       "children": []
      //                   }
      //               ]
      //           },
      //           {
      //               "id": "2160",
      //               "title": "2. neo4j",
      //               "parentId": "1",
      //               "children": []
      //           },
      //           {
      //               "id": "2165",
      //               "title": "3. sql",
      //               "parentId": "1",
      //               "children": []
      //           },
      //           {
      //               "id": "2170",
      //               "title": "_4. storing face descriptors",
      //               "parentId": "1",
      //               "children": []
      //           },
      //           {
      //               "id": "2191",
      //               "title": "go",
      //               "parentId": "1",
      //               "children": []
      //           },
      //           {
      //               "id": "2397",
      //               "title": "python deployment",
      //               "parentId": "1",
      //               "children": [
      //                   {
      //                       "id": "2398",
      //                       "title": "render",
      //                       "parentId": "2397",
      //                       "children": []
      //                   },
      //                   {
      //                       "id": "2401",
      //                       "title": "fly",
      //                       "parentId": "2397",
      //                       "children": []
      //                   }
      //               ]
      //           },
      //           {
      //               "id": "2474",
      //               "title": "bookmarks template",
      //               "parentId": "1",
      //               "children": []
      //           },
      //           {
      //               "id": "2506",
      //               "title": "watchlater",
      //               "parentId": "1",
      //               "children": []
      //           }
      //       ]
      //   },
      //   {
      //       "id": "2",
      //       "title": "Other Bookmarks",
      //       "parentId": "0",
      //       "children": [
      //           {
      //               "id": "1100",
      //               "title": "_",
      //               "parentId": "2",
      //               "children": [
      //                   {
      //                       "id": "429",
      //                       "title": "sg",
      //                       "parentId": "1100",
      //                       "children": [
      //                           {
      //                               "id": "430",
      //                               "title": "dashboard references",
      //                               "parentId": "429",
      //                               "children": []
      //                           },
      //                           {
      //                               "id": "473",
      //                               "title": "1",
      //                               "parentId": "429",
      //                               "children": []
      //                           }
      //                       ]
      //                   },
      //                   {
      //                       "id": "702",
      //                       "title": "jobs",
      //                       "parentId": "1100",
      //                       "children": []
      //                   },
      //                   {
      //                       "id": "971",
      //                       "title": "nlp courses",
      //                       "parentId": "1100",
      //                       "children": []
      //                   },
      //                   {
      //                       "id": "1034",
      //                       "title": "models",
      //                       "parentId": "1100",
      //                       "children": []
      //                   },
      //                   {
      //                       "id": "1043",
      //                       "title": "mach1",
      //                       "parentId": "1100",
      //                       "children": []
      //                   },
      //                   {
      //                       "id": "1081",
      //                       "title": "mach-latest",
      //                       "parentId": "1100",
      //                       "children": []
      //                   },
      //                   {
      //                       "id": "5",
      //                       "title": "⠀",
      //                       "parentId": "1100",
      //                       "children": [
      //                           {
      //                               "id": "6",
      //                               "title": "projects",
      //                               "parentId": "5",
      //                               "children": [
      //                                   {
      //                                       "id": "7",
      //                                       "title": "soundfuck",
      //                                       "parentId": "6",
      //                                       "children": []
      //                                   },
      //                                   {
      //                                       "id": "14",
      //                                       "title": "txtboo",
      //                                       "parentId": "6",
      //                                       "children": []
      //                                   },
      //                                   {
      //                                       "id": "20",
      //                                       "title": "nestedmaps",
      //                                       "parentId": "6",
      //                                       "children": []
      //                                   }
      //                               ]
      //                           },
      //                           {
      //                               "id": "35",
      //                               "title": "content",
      //                               "parentId": "5",
      //                               "children": [
      //                                   {
      //                                       "id": "36",
      //                                       "title": "thoughts / reflections",
      //                                       "parentId": "35",
      //                                       "children": []
      //                                   },
      //                                   {
      //                                       "id": "44",
      //                                       "title": "text",
      //                                       "parentId": "35",
      //                                       "children": []
      //                                   },
      //                                   {
      //                                       "id": "72",
      //                                       "title": "music",
      //                                       "parentId": "35",
      //                                       "children": []
      //                                   },
      //                                   {
      //                                       "id": "255",
      //                                       "title": "movies",
      //                                       "parentId": "35",
      //                                       "children": []
      //                                   },
      //                                   {
      //                                       "id": "263",
      //                                       "title": "art",
      //                                       "parentId": "35",
      //                                       "children": []
      //                                   }
      //                               ]
      //                           },
      //                           {
      //                               "id": "279",
      //                               "title": "hot",
      //                               "parentId": "5",
      //                               "children": [
      //                                   {
      //                                       "id": "309",
      //                                       "title": "porn",
      //                                       "parentId": "279",
      //                                       "children": []
      //                                   }
      //                               ]
      //                           },
      //                           {
      //                               "id": "320",
      //                               "title": "life",
      //                               "parentId": "5",
      //                               "children": [
      //                                   {
      //                                       "id": "321",
      //                                       "title": "tennis",
      //                                       "parentId": "320",
      //                                       "children": []
      //                                   },
      //                                   {
      //                                       "id": "326",
      //                                       "title": "шмот",
      //                                       "parentId": "320",
      //                                       "children": []
      //                                   }
      //                               ]
      //                           }
      //                       ]
      //                   },
      //                   {
      //                       "id": "351",
      //                       "title": "хата",
      //                       "parentId": "1100",
      //                       "children": []
      //                   },
      //                   {
      //                       "id": "363",
      //                       "title": "шмот",
      //                       "parentId": "1100",
      //                       "children": []
      //                   },
      //                   {
      //                       "id": "368",
      //                       "title": "муз примочки",
      //                       "parentId": "1100",
      //                       "children": []
      //                   },
      //                   {
      //                       "id": "850",
      //                       "title": "новосиб фон",
      //                       "parentId": "1100",
      //                       "children": []
      //                   },
      //                   {
      //                       "id": "922",
      //                       "title": "mach",
      //                       "parentId": "1100",
      //                       "children": []
      //                   },
      //                   {
      //                       "id": "1192",
      //                       "title": "спина",
      //                       "parentId": "1100",
      //                       "children": []
      //                   }
      //               ]
      //           },
      //           {
      //               "id": "1190",
      //               "title": "222",
      //               "parentId": "2",
      //               "children": [
      //                   {
      //                       "id": "1105",
      //                       "title": "mach mongo db",
      //                       "parentId": "1190",
      //                       "children": []
      //                   },
      //                   {
      //                       "id": "1114",
      //                       "title": "tags cloud",
      //                       "parentId": "1190",
      //                       "children": []
      //                   },
      //                   {
      //                       "id": "1116",
      //                       "title": "chapters disclosures",
      //                       "parentId": "1190",
      //                       "children": []
      //                   },
      //                   {
      //                       "id": "1122",
      //                       "title": "mach highlight most important parts",
      //                       "parentId": "1190",
      //                       "children": []
      //                   },
      //                   {
      //                       "id": "1141",
      //                       "title": "2",
      //                       "parentId": "1190",
      //                       "children": []
      //                   },
      //                   {
      //                       "id": "1163",
      //                       "title": "eager",
      //                       "parentId": "1190",
      //                       "children": []
      //                   }
      //               ]
      //           },
      //           {
      //               "id": "1245",
      //               "title": "11121",
      //               "parentId": "2",
      //               "children": [
      //                   {
      //                       "id": "1216",
      //                       "title": "13",
      //                       "parentId": "1245",
      //                       "children": [
      //                           {
      //                               "id": "1214",
      //                               "title": "2",
      //                               "parentId": "1216",
      //                               "children": []
      //                           }
      //                       ]
      //                   },
      //                   {
      //                       "id": "1224",
      //                       "title": "3",
      //                       "parentId": "1245",
      //                       "children": []
      //                   }
      //               ]
      //           },
      //           {
      //               "id": "1400",
      //               "title": "мансарда",
      //               "parentId": "2",
      //               "children": []
      //           },
      //           {
      //               "id": "1629",
      //               "title": "machcast refs",
      //               "parentId": "2",
      //               "children": []
      //           },
      //           {
      //               "id": "1864",
      //               "title": "ttt",
      //               "parentId": "2",
      //               "children": []
      //           },
      //           {
      //               "id": "1896",
      //               "title": "22",
      //               "parentId": "2",
      //               "children": []
      //           },
      //           {
      //               "id": "1937",
      //               "title": "26 june",
      //               "parentId": "2",
      //               "children": []
      //           },
      //           {
      //               "id": "1961",
      //               "title": "312",
      //               "parentId": "2",
      //               "children": []
      //           },
      //           {
      //               "id": "1974",
      //               "title": "вана",
      //               "parentId": "2",
      //               "children": []
      //           },
      //           {
      //               "id": "2002",
      //               "title": "44444",
      //               "parentId": "2",
      //               "children": []
      //           },
      //           {
      //               "id": "2029",
      //               "title": "3123213",
      //               "parentId": "2",
      //               "children": []
      //           },
      //           {
      //               "id": "2053",
      //               "title": "313131",
      //               "parentId": "2",
      //               "children": []
      //           },
      //           {
      //               "id": "2059",
      //               "title": "8.07.23",
      //               "parentId": "2",
      //               "children": []
      //           },
      //           {
      //               "id": "2066",
      //               "title": "latest",
      //               "parentId": "2",
      //               "children": []
      //           },
      //           {
      //               "id": "2223",
      //               "title": "nex",
      //               "parentId": "2",
      //               "children": []
      //           },
      //           {
      //               "id": "2290",
      //               "title": "проктология",
      //               "parentId": "2",
      //               "children": []
      //           },
      //           {
      //               "id": "2332",
      //               "title": "audio embeddings",
      //               "parentId": "2",
      //               "children": []
      //           },
      //           {
      //               "id": "2353",
      //               "title": "ML learning",
      //               "parentId": "2",
      //               "children": []
      //           },
      //           {
      //               "id": "2368",
      //               "title": "mac mini m1",
      //               "parentId": "2",
      //               "children": []
      //           },
      //           {
      //               "id": "2383",
      //               "title": "psy.bot",
      //               "parentId": "2",
      //               "children": []
      //           }
      //       ]
      //   }
      // ]
      // }

      // There are a lot of bookmarks so user will feed it to you in multiple messages.

      // In your response, include two things:

      // 1. An array of actions you want to apply to change the folders structure, eg:
      // \`\`\`
      // [
      // renameFolder(id, newName)
      // createFolder(id, name)
      // moveFolder(id, newParentId)
      // deleteFolder(id)
      // ]
      // \`\`\`

      // (for generating ids use some new unique ids, eg 'FOLDER_8')

      // 2. Updated bookmarks (with updated parent ids) in the following format:

      // \`\`\`
      // [
      // {
      // id: 1,
      // oldParentId: 4,
      // newParentId: 6
      // },
      // …
      // ]
      // \`\`\`

      // Try to not be too generic about naming folders. Adapt the folders structure as more links come in.`,
      // },
      ...messages,
    ],
    stream: true,
  })

  // Convert the response into a friendly text-stream
  const stream = OpenAIStream(response)

  // Respond with the stream
  return new StreamingTextResponse(stream)
}

export default handler
