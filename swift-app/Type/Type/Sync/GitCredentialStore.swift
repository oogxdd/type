//
//  GitCredentialStore.swift
//  Type
//
//  Keychain storage for the git secret (Personal Access Token / password),
//  keyed by workspace id so each workspace can target a different remote. The
//  username and remote URL live in (non-secret) workspace settings.
//

import Foundation
import Security

enum GitCredentialStore {
    private static let service = "com.digital.Type.git"

    static func saveSecret(_ secret: String, workspaceId: String) {
        deleteSecret(workspaceId: workspaceId)
        guard !secret.isEmpty, let data = secret.data(using: .utf8) else { return }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: workspaceId,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        SecItemAdd(query as CFDictionary, nil)
    }

    static func secret(workspaceId: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: workspaceId,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
            let data = result as? Data,
            let string = String(data: data, encoding: .utf8)
        else { return nil }
        return string
    }

    static func deleteSecret(workspaceId: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: workspaceId,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
