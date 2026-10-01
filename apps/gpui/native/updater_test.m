// Synthetic lifecycle checks: no Sparkle startup or access to app data.
#import "updater.m"
#include <assert.h>
static bool prepare(void *context) { return *(bool *)context; }
int main(void) {
    @autoreleasepool {
        assert(type_updater_create(prepare, NULL) == NULL);
        bool ready = false;
        TypeUpdateBridge *bridge = [TypeUpdateBridge new];
        bridge.prepare = prepare;
        bridge.context = &ready;
        NSError *error = nil;
        assert(![bridge updater:nil mayPerformUpdateCheck:0 error:&error]);
        assert(error != nil);
        __block bool installed = false;
        assert([bridge updater:nil shouldPostponeRelaunchForUpdate:nil untilInvokingBlock:^{ installed = true; }]);
        assert(bridge.pendingInstall != nil);
        ready = true;
        assert([bridge updater:nil mayPerformUpdateCheck:0 error:NULL]);
        type_updater_check((__bridge void *)bridge);
        NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:1];
        while (!installed && deadline.timeIntervalSinceNow > 0) {
            [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
        }
        assert(installed);
        assert(bridge.pendingInstall == nil);
        assert(![bridge updater:nil shouldPostponeRelaunchForUpdate:nil untilInvokingBlock:^{}]);
        bridge.context = NULL;
        assert(![bridge updater:nil mayPerformUpdateCheck:0 error:NULL]);
    }
    return 0;
}
