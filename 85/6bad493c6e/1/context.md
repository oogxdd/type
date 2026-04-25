# Session Context

## User Prompts

### Prompt 1

Hi. Currently. I have the "production" version (the build from long time ago, before i implemented the releases workflow) of this app installed as well as development. I want to understand where my data is stored currently. (I want to just "backup" all of the notes and start fresh with the production one)


Another question. When I will build the production .dmg and install. Will it save the data to the same location as when I will develop it? Or will it be different?

### Prompt 2

➜  ~ open  ~/Library/Application Support/com.digital.type/
The files /Users/digital/Library/Application and /Users/digital/Support/com.digital.type do not exist.
➜  ~ cd Projects/type/app
➜  ~ ls  ~/Library/Application Support/
ls: /Users/digital/Library/Application: No such file or directory
ls: Support/: No such file or directory
➜  ~ sudo
➜  ~ sudo ls  ~/Library/Application Support/
Password:
ls: /Users/digital/Library/Application: No such file or directory
ls: Support/: No such file or di...

### Prompt 3

ok now. please explore all inside com.digital.type2. merge all profiles into single one. normalize all the data (i remember when developing i was making changes on the file structure and notes naming and other things). i already backed this up

### Prompt 4

actually explore within the DATA folder inside this repo. merge all profiles and all data into single one. normalize all the data (i remember when developing i was making changes on the file structure and notes naming and other things). i already backed this up

### Prompt 5

я полагаю что из unsorted они должны перейти в feed.

и посмотри где у меня сейчас папки в приложении сохраняются? они сохраняются внутри "Folders/" или прямо в root?

### Prompt 6

propose me few options. 

one is to have system folders in lowercase and starting with underscore

other is to have "custom folders" inside the "Folders/" directory

### Prompt 7

please do the option B

### Prompt 8

[Request interrupted by user for tool use]

### Prompt 9

hey wait. i see you added this method "migrate_user_folders_to_subdirectory". but why do i need it? i'm starting resh. and i dont see where this method is needed apart from backwards compability.

### Prompt 10

1) make a commit
2) i dont get why do i need root leve order file? i only need it within the folders (including in the root of the "Folders" to define the folders order (order file is responsible for both notes and folders order. also i dont need order file in feed/archive)
3) so now by default if i create folders from the app - they are created inside the "Folders" dir?

