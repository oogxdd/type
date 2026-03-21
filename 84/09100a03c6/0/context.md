# Session Context

## User Prompts

### Prompt 1

Hi. Where are my notes located? give me the path

### Prompt 2

where did you get the thinktool from....

### Prompt 3

Ok. Question. So the sync in this app is implemented via git. 

But ideally later on I want my flow to be like following:


1. I walk outside. I make notes and make voice recordings. I don't transcribe it right away as in the future I will use my local AI models to do that (so only when i sync with my home station)

2. I come home. I press sync. The notes and voice recordings are transported to my host. Then transcription happens. Then if I sync again - my phone picks up those transcription. ...

### Prompt 4

i like option 2 but please explain me option 1 first. what does it mean "prune"? if i set up a new phone eg and "cloning the repo" - will i initially download the audio files as well?

### Prompt 5

and if i set up the local git on my machine (not remote git service like github) - will it be supported? (in which cases yes in which cases no)

### Prompt 6

" SSH remote (ssh://home-server/repo.git): Also doesn't work out of the box. Same reason — LFS needs an HTTP API endpoint, not just git's
   SSH transport."


how do i set this up and push from my phone to pc?

### Prompt 7

ok. imagine i have run the gitea server. and both my phone and macbook on the same wifi network. 

1) how do i actually sync (from phone to desktop and vice versa)

2) will the traffic be secured?

### Prompt 8

again, why we decided against ssh connection?

### Prompt 9

and how would the flow work?

1) phone generates ssh

then what?

### Prompt 10

" The only thing you'd still want Tailscale for is if you want sync to work outside your home WiFi." - why? if eg i only sync when on the same wifi

### Prompt 11

"  3. Set the remote URL in the app — something like ssh://your-user@192.168.1.XX/home/your-user/notes.git"

- how woudl that work? would i need to specifically expose some my mac ports or smth? how will i find out the ip? will i need to also input password in the address?

### Prompt 12

"Ports: You need to enable Remote Login on your Mac. System Settings → General → Sharing → Remote Login. That's it — it enables the SSH
  server on port 22. No extra port forwarding needed since you're on the same WiFi.
"

is it safe tho?

### Prompt 13

ok. i like this option но просто пройдемся по альтернативе чтобы до конца закончить с этим так скажем

допустим при синке я бы просто делал по гит протоколу через personal hospot раздатый с айфона (специально менял бы нетворк на период синка)

### Prompt 14

ну я имею ввиду по локал хостопу мог бы и без ssh

### Prompt 15

не, а почему обязательно http server а не просто git daemon и git protocol

### Prompt 16

"  - Нужно каждый раз запускать git daemon на маке перед синком"


а если по ssh то как?

### Prompt 17

ладно. плз заимплементи ssh way

### Prompt 18

Look. I have another question. Is it possible that that I allow ssh onto my computer only in limited scope (eg just a git folder and git interactions)

### Prompt 19

can you document it in a separate readme

### Prompt 20

yep. also later commit all your changes

