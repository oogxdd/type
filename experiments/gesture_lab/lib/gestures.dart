import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';

/// A horizontal drag recognizer that decides on *direction* rather than racing
/// everyone else to the touch slop.
///
/// Two things go wrong with the stock [HorizontalDragGestureRecognizer] when it
/// sits above a text field inside a vertical scroll view, and both of them look
/// like "the app doesn't capture my gestures":
///
/// 1. It accepts the arena as soon as |dx| crosses the touch slop *without
///    looking at dy*. Above a [Scrollable] that makes every diagonal flick a
///    coin toss — whichever axis happens to cross slop on the earlier pointer
///    move wins.
/// 2. It loses clean horizontal swipes that start on a [TextField]. The field's
///    own selection recognizer accepts at the same ~18px distance but is deeper
///    in the tree, so it is dispatched first and takes the gesture — even on
///    mobile, where it then does nothing visible with it.
///
/// So this subclass replaces "first past the post" with an explicit verdict:
/// bail out early when the travel reads as vertical (handing the scrollable a
/// clean win), and claim the arena early when it reads as horizontal — before
/// the text field can. Both decisions need real directional evidence, so a tap
/// or a long-press is never affected.
class DirectionalHorizontalDragRecognizer
    extends HorizontalDragGestureRecognizer {
  DirectionalHorizontalDragRecognizer({
    super.debugOwner,
    this.verticalBailout = 8.0,
    this.horizontalCommit = 12.0,
    this.dominanceRatio = 1.2,
  });

  /// How far the finger must travel vertically before we consider bailing out.
  final double verticalBailout;

  /// How far it must travel horizontally before we claim the gesture. Kept
  /// under the default touch slop so we beat the text field's recognizer.
  final double horizontalCommit;

  /// How lopsided the travel must be to count as one axis or the other.
  final double dominanceRatio;

  final Map<int, Offset> _travel = <int, Offset>{};

  @override
  void addAllowedPointer(PointerDownEvent event) {
    _travel[event.pointer] = Offset.zero;
    super.addAllowedPointer(event);
  }

  @override
  void handleEvent(PointerEvent event) {
    if (event is PointerMoveEvent) {
      final Offset total =
          (_travel[event.pointer] ?? Offset.zero) + event.delta;
      _travel[event.pointer] = total;
      gestureDebug.axis.value =
          '${total.dx.toStringAsFixed(0)},${total.dy.toStringAsFixed(0)}';
      if (total.dy.abs() > verticalBailout &&
          total.dy.abs() > total.dx.abs() * dominanceRatio) {
        _travel.remove(event.pointer);
        // Concede. The scrollable below us takes over for good.
        resolve(GestureDisposition.rejected);
        return;
      }
      if (total.dx.abs() > horizontalCommit &&
          total.dx.abs() > total.dy.abs() * dominanceRatio) {
        // Claim it. DragGestureRecognizer.acceptGesture replays the pending
        // offset through onStart/onUpdate, so nothing is lost by deciding
        // before the usual slop.
        resolve(GestureDisposition.accepted);
      }
    }
    super.handleEvent(event);
  }

  @override
  void didStopTrackingLastPointer(int pointer) {
    _travel.remove(pointer);
    super.didStopTrackingLastPointer(pointer);
  }

  @override
  String get debugDescription => 'directional horizontal drag';
}

/// Live gesture numbers for the on-screen HUD. Plain notifiers so the HUD can
/// repaint without dragging the whole tree through setState on every frame.
class GestureDebug {
  final ValueNotifier<bool> visible = ValueNotifier<bool>(true);
  final ValueNotifier<String> axis = ValueNotifier<String>('0,0');
  final ValueNotifier<double> menu = ValueNotifier<double>(0);
  final ValueNotifier<double> pull = ValueNotifier<double>(0);
  final ValueNotifier<bool> armed = ValueNotifier<bool>(false);
  final ValueNotifier<String> phase = ValueNotifier<String>('idle');
}

final GestureDebug gestureDebug = GestureDebug();
