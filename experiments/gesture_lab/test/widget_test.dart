import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:gesture_lab/capture_page.dart';
import 'package:gesture_lab/main.dart';
import 'package:gesture_lab/menu_page.dart';

/// Drags in small steps so the gesture recognizers see a realistic stream of
/// pointer moves, and leaves the finger *down* so the caller decides when the
/// release happens.
///
/// The timestamps matter: TestGesture.moveBy stamps every event at t=0 by
/// default, which makes VelocityTracker report zero and silently skips every
/// fling path in the app.
Future<TestGesture> dragInSteps(
  WidgetTester tester,
  Offset from,
  Offset step, {
  int count = 12,
  Duration interval = const Duration(milliseconds: 16),
}) async {
  Duration clock = Duration.zero;
  final TestGesture gesture = await tester.startGesture(from);
  for (int i = 0; i < count; i++) {
    clock += interval;
    await gesture.moveBy(step, timeStamp: clock);
    await tester.pump(interval);
  }
  return gesture;
}

Finder get _liveField => find.byType(TextField).first;

double capturePageX(WidgetTester tester) =>
    tester.getTopLeft(find.byType(CapturePage).last).dx;

void main() {
  testWidgets(
    'pulling past the threshold files the note and opens a blank one',
    (WidgetTester tester) async {
      await tester.pumpWidget(const GestureLabApp());
      await tester.pumpAndSettle();

      await tester.enterText(_liveField, 'first note');
      await tester.pumpAndSettle();
      expect(find.text('note 1'), findsOneWidget);

      final TestGesture gesture = await dragInSteps(
        tester,
        tester.getCenter(_liveField),
        const Offset(0, -28),
      );
      // The tab only arms once the overscroll clears the threshold.
      expect(find.text('Release for new note'), findsOneWidget);

      await gesture.up();
      await tester.pumpAndSettle();

      expect(find.text('note 2'), findsOneWidget);
      expect(find.text('note 1'), findsNothing);
      // The old note is filed, not lost.
      expect(find.widgetWithText(ListTile, 'first note'), findsOneWidget);
    },
  );

  testWidgets('releasing below the threshold keeps you on the same note', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const GestureLabApp());
    await tester.pumpAndSettle();

    final TestGesture gesture = await dragInSteps(
      tester,
      tester.getCenter(_liveField),
      const Offset(0, -6),
      count: 4,
    );
    expect(find.text('Release for new note'), findsNothing);

    await gesture.up();
    await tester.pumpAndSettle();

    expect(find.text('note 1'), findsOneWidget);
  });

  testWidgets('a horizontal swipe opens the menu and keeps capture mounted', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const GestureLabApp());
    await tester.pumpAndSettle();

    await tester.enterText(_liveField, 'kept across the trip');
    await tester.pumpAndSettle();
    final double width = tester.getSize(find.byType(CapturePage).last).width;

    final TestGesture open = await dragInSteps(
      tester,
      tester.getCenter(_liveField),
      const Offset(30, 0),
    );
    await open.up();
    await tester.pumpAndSettle();

    expect(capturePageX(tester), moreOrLessEquals(width, epsilon: 0.5));
    // Same State object, same controller, same text — never unmounted.
    final TextField field = tester.widget<TextField>(_liveField);
    expect(field.controller!.text, 'kept across the trip');

    // The capture page has slid fully off-screen, so swipe back from the menu
    // itself — the swipe layer spans the whole window either way.
    final TestGesture close = await dragInSteps(
      tester,
      tester.getCenter(find.byType(MenuPage)),
      const Offset(-30, 0),
    );
    await close.up();
    await tester.pumpAndSettle();

    expect(capturePageX(tester), moreOrLessEquals(0, epsilon: 0.5));
    expect(
      tester.widget<TextField>(_liveField).controller!.text,
      'kept across the trip',
    );
  });

  testWidgets('a vertical-dominant drag never leaks into the menu', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const GestureLabApp());
    await tester.pumpAndSettle();

    // Up and to the right: the stock HorizontalDragGestureRecognizer would
    // race this and sometimes win. DirectionalHorizontalDragRecognizer bails.
    final TestGesture gesture = await dragInSteps(
      tester,
      tester.getCenter(_liveField),
      const Offset(10, -26),
    );
    await gesture.up();
    await tester.pumpAndSettle();

    expect(capturePageX(tester), moreOrLessEquals(0, epsilon: 0.5));
  });
}
