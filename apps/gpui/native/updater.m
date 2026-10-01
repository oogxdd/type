// Sparkle is loaded from the signed bundle; debug/standalone binaries need no
// framework. These declarations mirror Sparkle 2's public Objective-C API.
#import <Foundation/Foundation.h>
#import <dlfcn.h>

@interface NSObject (TypeSparkleAPI)
- (id)initWithStartingUpdater:(BOOL)start updaterDelegate:(id)delegate userDriverDelegate:(id)driver;
- (BOOL)startUpdater:(NSError **)error;
- (id)updater;
- (void)checkForUpdates:(id)sender;
- (void)setAutomaticallyChecksForUpdates:(BOOL)value;
- (BOOL)automaticallyChecksForUpdates;
@end

typedef bool (*TypePrepareUpdate)(void *);
@interface TypeUpdateBridge : NSObject
@property(nonatomic, strong) id controller;
@property(nonatomic) TypePrepareUpdate prepare;
@property(nonatomic) void *context;
@property(nonatomic, copy) void (^pendingInstall)(void);
@end

@implementation TypeUpdateBridge
- (BOOL)updater:(id)updater mayPerformUpdateCheck:(NSInteger)check error:(NSError **)error {
    if (self.context && self.prepare(self.context)) return YES;
    if (error) *error = [NSError errorWithDomain:@"com.digital.type2.updater" code:1
        userInfo:@{NSLocalizedDescriptionKey: @"Save your notes and finish the current operation before updating."}];
    return NO;
}
- (BOOL)updater:(id)updater shouldPostponeRelaunchForUpdate:(id)item untilInvokingBlock:(void (^)(void))handler {
    if (self.context && self.prepare(self.context)) return NO;
    self.pendingInstall = handler;
    return YES;
}
@end

void *type_updater_create(TypePrepareUpdate prepare, void *context) {
    NSBundle *bundle = NSBundle.mainBundle;
    if (![bundle.bundleIdentifier isEqualToString:@"com.digital.type2"] ||
        ![bundle objectForInfoDictionaryKey:@"SUFeedURL"] ||
        ![bundle objectForInfoDictionaryKey:@"SUPublicEDKey"]) return NULL;
    NSString *path = [bundle.privateFrameworksPath stringByAppendingPathComponent:@"Sparkle.framework/Sparkle"];
    // The handle intentionally lives until process exit; Objective-C classes
    // cannot be safely unloaded. Library validation enforces our signing team.
    if (!dlopen(path.fileSystemRepresentation, RTLD_NOW | RTLD_LOCAL)) return NULL;
    Class controllerClass = NSClassFromString(@"SPUStandardUpdaterController");
    if (!controllerClass) return NULL;
    TypeUpdateBridge *bridge = [TypeUpdateBridge new];
    bridge.prepare = prepare;
    bridge.context = context;
    bridge.controller = [[controllerClass alloc] initWithStartingUpdater:NO updaterDelegate:bridge userDriverDelegate:nil];
    NSError *error = nil;
    if (!bridge.controller || ![[bridge.controller updater] startUpdater:&error]) {
        NSLog(@"Type updater could not start: %@", error);
        return NULL;
    }
    return (__bridge_retained void *)bridge;
}

void type_updater_check(void *handle) {
    TypeUpdateBridge *bridge = (__bridge TypeUpdateBridge *)handle;
    // Run outside GPUI's mutable App borrow, including on a failed-save retry.
    dispatch_async(dispatch_get_main_queue(), ^{
        if (!bridge.context) return;
        if (bridge.pendingInstall) {
            if (bridge.prepare(bridge.context)) {
                void (^install)(void) = bridge.pendingInstall;
                bridge.pendingInstall = nil;
                install();
            }
        } else {
            [bridge.controller checkForUpdates:nil];
        }
    });
}
bool type_updater_automatic(void *handle) {
    return [[((__bridge TypeUpdateBridge *)handle).controller updater] automaticallyChecksForUpdates];
}
void type_updater_set_automatic(void *handle, bool enabled) {
    [[((__bridge TypeUpdateBridge *)handle).controller updater] setAutomaticallyChecksForUpdates:enabled];
}
void type_updater_destroy(void *handle) {
    TypeUpdateBridge *bridge = (__bridge_transfer TypeUpdateBridge *)handle;
    bridge.context = NULL;
    bridge.pendingInstall = nil;
    bridge.controller = nil;
}
