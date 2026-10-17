#import <AVFoundation/AVFoundation.h>
#include <stdio.h>
#include <math.h>

// The GPUI UI thread owns the retained player and releases it on navigation.
void *type_audio_open(const char *path, char *error, size_t capacity) {
    @autoreleasepool {
        NSError *failure = nil;
        NSString *filename = [[NSString alloc] initWithUTF8String:path];
        AVAudioPlayer *player = filename ? [[AVAudioPlayer alloc]
            initWithContentsOfURL:[NSURL fileURLWithPath:filename] error:&failure] : nil;
        if (!player || !isfinite(player.duration) || player.duration <= 0) {
            snprintf(error, capacity, "%s", (failure.localizedDescription ?: @"This audio format could not be opened.").UTF8String);
            return NULL;
        }
        return (__bridge_retained void *)player;
    }
}

bool type_audio_play(void *handle) {
    AVAudioPlayer *player = (__bridge AVAudioPlayer *)handle;
    if (player.currentTime >= player.duration - 0.01) player.currentTime = 0;
    return [player play];
}
void type_audio_pause(void *handle) { [(__bridge AVAudioPlayer *)handle pause]; }
bool type_audio_playing(void *handle) { return [(__bridge AVAudioPlayer *)handle isPlaying]; }
double type_audio_duration(void *handle) { return [(__bridge AVAudioPlayer *)handle duration]; }
double type_audio_position(void *handle) { return [(__bridge AVAudioPlayer *)handle currentTime]; }
void type_audio_seek(void *handle, double seconds) {
    AVAudioPlayer *player = (__bridge AVAudioPlayer *)handle;
    player.currentTime = fmax(0, fmin(seconds, player.duration));
}
void type_audio_destroy(void *handle) {
    AVAudioPlayer *player = (__bridge_transfer AVAudioPlayer *)handle;
    [player stop];
}
